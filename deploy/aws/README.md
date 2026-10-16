# Host QuizBlitz on AWS

This is the complete, step-by-step hosting guide for this repository. It adapts the AWS practicals to QuizBlitz: one EC2 instance runs the API, Socket.IO, and PostgreSQL; AWS Amplify hosts and deploys the frontend from Git. It also includes the separate S3, CodeBuild, Lambda/API Gateway, and SNS/SQS exercises.

## What you need first

- An AWS account and a chosen Region. Use the same Region for EC2, Amplify, S3, CodeBuild, Lambda, API Gateway, SNS, and SQS. Amplify manages the CDN used to serve the hosted frontend.
- A GitHub or CodeCommit repository containing this project, with `package-lock.json` and the root `amplify.yml` committed. Amplify cannot read files that exist only on your computer.
- A domain name for the API, such as `api.example.com`, so the browser can call the API over HTTPS. Amplify provides an HTTPS hostname for the frontend; a custom frontend domain is optional.
- A local copy of the project for the first-time setup, or repository access configured on the EC2 instance.

Keep `.env` files, passwords, private SSH keys, and JWT secrets out of Git. AWS resources can incur charges. This guide does not create resources automatically.

The commands below use Ubuntu Server 24.04 (`apt`, login user `ubuntu`). The classroom web-server practical used Amazon Linux (`dnf`, login user `ec2-user`); do not mix its commands with the Ubuntu commands here.

## How the AWS services fit

| Practical | Use in this deployment |
| --- | --- |
| EC2 | Runs Node/Express, Socket.IO, Nginx, and PostgreSQL on one backend instance. Keep one Node process because active game rooms and timers are in memory. |
| SSH/SCP | Optional first-time administration or file transfer. Limit SSH to your current IP. Session Manager is also available with the EC2 role below. |
| Apache/httpd | The lab used Apache. This guide uses Nginx as the reverse proxy because the included config forwards Socket.IO WebSocket connections. |
| Security Groups | Public inbound 80/443 for web traffic; SSH 22 from your IP only if used. Never expose 4000 or 5432. |
| IAM | EC2 gets an instance role for Session Manager. Amplify's Git connection handles frontend deployment. Do not put IAM user access keys on EC2. |
| Amplify Hosting | Builds and hosts the Vite frontend from the `client/` workspace. Pushes to the connected branch trigger deployments. |
| S3 | Use for the separate bucket/versioning/static website practical. Amplify manages the frontend hosting infrastructure, so this guide does not make an S3 bucket public for the app. |
| CodeBuild | Optional standalone build practical using [`buildspec.yml`](buildspec.yml); it builds the frontend but does not deploy it. |
| Lambda + API Gateway | Provides an independent `GET /hello` lab endpoint. It does not replace the app API or Socket.IO. |
| SNS + SQS | Repeat the email notification and queue practicals. They are not connected to game events in the current application. |

API Gateway WebSocket is not a drop-in Socket.IO server. QuizBlitz uses Socket.IO handshakes, rooms, events, and reconnects, so live game traffic must continue to reach Node on EC2.

## Step 1: Put the project in a Git repository

Create a private or public repository in GitHub or CodeCommit and push this project to its `main` branch. Make sure the repository contains the root `package.json`, `package-lock.json`, `client/`, `server/`, and `deploy/` folders. Do not commit `.env` or `.pem` files. CodeBuild needs access to this repository.

## Step 2: Create an EC2 IAM role

1. In AWS Console, open **IAM → Roles → Create role**.
2. Choose **AWS service**, then **EC2**.
3. Attach the AWS managed policy `AmazonSSMManagedInstanceCore`.
4. Name the role `QuizBlitzEc2Role` and create it.

This role allows Session Manager access without storing AWS keys on the server. Do not attach `AdministratorAccess`.

## Step 3: Launch `quizblitz-api`

1. Open **EC2 → Instances → Launch instances** and set the name to `quizblitz-api`.
2. Choose **Ubuntu Server 24.04 LTS**, 64-bit x86. A 2 GiB memory instance is more comfortable for PostgreSQL and Node; a 1 GiB instance can be used for a very small demo but may run short on memory.
3. In **Key pair (login)**, create and download a `.pem` key if you plan to use SSH. Store it safely; AWS cannot show/download the private key again. If using Session Manager only, a key pair is not needed.
4. In **Network settings**, enable auto-assign public IP. Create a security group with inbound TCP 80 (HTTP) and TCP 443 (HTTPS) from the internet. If using SSH, add TCP 22 with source **My IP**, never **Anywhere**. Do not add ports 4000 or 5432.
5. In **Advanced details → IAM instance profile**, select `QuizBlitzEc2Role`.
6. Set the root volume to at least 20 GiB gp3. Launch one instance and wait for **Running** and both status checks to pass.
7. Open **EC2 → Elastic IPs**, allocate an Elastic IP in this Region, then associate it with `quizblitz-api`. In your DNS provider, point `api.example.com` to that IP. Replace `api.example.com` below with your real API hostname.

## Step 4: Connect and install the server software

In **EC2 → Instances → Connect**, choose **Session Manager**. If the instance is not available there, confirm the IAM role is attached and the instance has internet access. Alternatively use SSH from PowerShell:

```powershell
ssh -i "C:\path\to\your-key.pem" ubuntu@YOUR_ELASTIC_IP
```

In the EC2 terminal, install PostgreSQL, Nginx, Git, Certbot prerequisites, and create the app account:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y postgresql nginx git curl build-essential snapd unzip
sudo adduser --disabled-password --gecos "" quizblitz
sudo install -d -o quizblitz -g quizblitz /var/www/quizblitz
```

Install Node.js 24 LTS and PM2 as the `quizblitz` user:

```bash
sudo -iu quizblitz
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
source ~/.bashrc
nvm install 24
nvm alias default 24
npm install --global pm2
node --version
npm --version
exit
```

## Step 5: Put the app files on EC2

For a GitHub repository, configure a read-only deploy key for the `quizblitz` Unix account, then clone the repository into the prepared directory:

```bash
sudo -iu quizblitz
git clone YOUR_REPOSITORY_SSH_URL /var/www/quizblitz
exit
```

Replace `YOUR_REPOSITORY_SSH_URL` with the repository's SSH clone URL. If using SCP instead, copy the project folders and lockfile from your computer to `/var/www/quizblitz`; exclude local `node_modules` and all `.env` files. Then make the app account the owner:

```bash
sudo chown -R quizblitz:quizblitz /var/www/quizblitz
```

## Step 6: Create PostgreSQL database and API environment

Generate a database password made of URL-safe hex characters:

```bash
openssl rand -hex 32
```

Copy the output somewhere private temporarily. Open PostgreSQL as its administrator:

```bash
sudo -u postgres psql
```

At the `psql` prompt, replace `PASTE_HEX_PASSWORD` with the generated value:

```sql
CREATE ROLE quizblitz LOGIN PASSWORD 'PASTE_HEX_PASSWORD';
CREATE DATABASE quizblitz OWNER quizblitz;
\q
```

PostgreSQL must remain local to this instance. Do not change its listener to `*` and do not allow port 5432 in the security group.

Create the server environment file:

```bash
sudo -iu quizblitz
cd /var/www/quizblitz
cp server/.env.example server/.env
openssl rand -base64 48
nano server/.env
```

Set these values in `server/.env` (use the same database password created above, a new JWT secret from the command, and your real API domain):

```env
NODE_ENV=production
PORT=4000
HOST=127.0.0.1
CLIENT_ORIGIN=https://YOUR_FRONTEND_DOMAIN
DATABASE_URL=postgres://quizblitz:PASTE_HEX_PASSWORD@127.0.0.1:5432/quizblitz
DATABASE_SSL=false
TRUST_PROXY=true
JWT_SECRET=PASTE_RANDOM_BASE64_SECRET
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=12
```

`YOUR_FRONTEND_DOMAIN` will be the Amplify branch domain created in Step 9, or your custom site domain. Return to this file after Step 9 and replace the temporary value with the exact origin (scheme and hostname, no trailing slash). Save and exit `nano` with Ctrl+O, Enter, Ctrl+X. Then restrict the file and install dependencies/run migrations:

```bash
chmod 600 server/.env
npm ci
npm --workspace server run db:migrate
```

## Step 7: Start the API and configure Nginx

Start the server as the `quizblitz` user:

```bash
pm2 startOrReload deploy/ecosystem.config.cjs --env production --update-env
pm2 save
pm2 startup
```

PM2 prints a `sudo ... pm2 startup ...` command. Copy and run that exact command, then run `pm2 save` again as `quizblitz`. The PM2 configuration uses one forked process; do not increase the instance count for this in-memory game server.

Install the included Nginx configuration. First edit the source file and replace `api.example.com` with your actual API hostname:

```bash
cd /var/www/quizblitz
nano deploy/backend.nginx.conf
sudo cp deploy/backend.nginx.conf /etc/nginx/sites-available/quizblitz-api
sudo ln -s /etc/nginx/sites-available/quizblitz-api /etc/nginx/sites-enabled/quizblitz-api
sudo nginx -t
sudo systemctl reload nginx
```

Check the API locally on EC2:

```bash
curl --fail http://127.0.0.1:4000/api/health
```

It should return `{"status":"ok"}`. Nginx forwards `/socket.io/` with WebSocket upgrade headers and keeps connections open for game rounds. The EC2 security group must still have no inbound rule for port 4000.

## Step 8: Enable HTTPS for the API

The frontend will be HTTPS, so the API must also use HTTPS or browsers will block its requests. Make sure `api.example.com` resolves to the EC2 Elastic IP and ports 80/443 are allowed before requesting a certificate.

Install Certbot and request the certificate:

```bash
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/local/bin/certbot
sudo certbot --nginx -d api.example.com
sudo certbot renew --dry-run
```

Replace the example hostname with your real API hostname. Test `https://api.example.com/api/health` from your computer before continuing. If you do not own a domain, acquire one or use an HTTPS load balancer with an ACM certificate; a raw EC2 IP address cannot provide a trusted browser certificate for this setup.

## Step 9: Connect the repository to Amplify Hosting

The root [`amplify.yml`](../../amplify.yml) builds the npm workspace from the repository root and publishes `client/dist`. Commit this file before connecting the repo.

1. Open **AWS Amplify → Create new app → Host web app**.
2. Choose GitHub or CodeCommit, authorize the connection, then select this repository and the `main` branch.
3. Enable **My app is a monorepo** and enter `client` as the app root. Amplify should set `AMPLIFY_MONOREPO_APP_ROOT=client` for the app. The app root must match the `appRoot` entry in `amplify.yml`.
4. Review the build settings. Keep the repository's `amplify.yml`; it installs from the root lockfile, builds `@quizblitz/client`, and publishes `client/dist`.
5. Add the environment variable `VITE_API_URL` with value `https://api.example.com` (replace with your API domain). This is a public URL embedded in the browser build, not a secret. Never add `JWT_SECRET`, database passwords, or other backend secrets to Amplify frontend variables.
6. Choose **Save and deploy**. Wait for the first deployment to complete and copy the generated branch URL, for example `https://main.xxxxx.amplifyapp.com`.

Amplify supports npm-workspace monorepos through a root build specification and `AMPLIFY_MONOREPO_APP_ROOT`; see [AWS monorepo configuration](https://docs.aws.amazon.com/amplify/latest/userguide/monorepo-configuration.html). Frontend environment variables are used at build time and must not contain secrets; see [AWS Amplify environment variable guidance](https://docs.aws.amazon.com/amplify/latest/userguide/environment-variables.html).

## Step 10: Configure Amplify SPA routing and the API origin

In Amplify, open **Hosting → Rewrites and redirects → Manage redirects** and add this rule so React Router routes work after refresh:

```json
[
  {
    "source": "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>",
    "status": "200",
    "target": "/index.html",
    "condition": null
  }
]
```

This is an Amplify 200 rewrite to the SPA entry point, not a redirect in the browser. See [AWS Amplify SPA rewrite guidance](https://docs.aws.amazon.com/amplify/latest/userguide/redirect-rewrite-examples.html).

Set `CLIENT_ORIGIN` on EC2 to the exact Amplify branch origin, such as `https://main.xxxxx.amplifyapp.com`, then restart the API:

```bash
sudo -iu quizblitz
nano /var/www/quizblitz/server/.env
pm2 restart quizblitz-api --update-env
exit
```

If you later add a custom domain in **Amplify → Hosting → Custom domains**, update `CLIENT_ORIGIN` to that exact HTTPS origin and restart the API again. Amplify provides the HTTPS frontend endpoint; the API still needs its own valid HTTPS domain/certificate.

## Step 11: Run the CodeBuild practical (optional)

Amplify already builds and deploys the website. To practice CodeBuild separately, create a build project connected to the same repository and `main` branch, choose a managed Linux image with Node.js 22 or 24, and set the buildspec path to `deploy/aws/buildspec.yml`. Configure the project with **No artifacts**; the practical is to run the build and inspect its logs, not to publish another copy of the site. Choose **Start build** and confirm the frontend build succeeds.

## Step 12: Test the hosted game

## Step 12: Test the hosted game

1. Open the Amplify branch URL over HTTPS. Refresh directly on `/dashboard`, `/history`, and `/join`.
2. Sign up, create a quiz with at least two questions, and open the host game screen.
3. Join from a second browser/device with a player nickname. Start a round, answer, advance, and finish the game.
4. Confirm the live game stays connected, the result appears in history, and the browser console has no CORS or mixed-content errors.
5. On EC2, useful checks are:

   ```bash
   sudo systemctl status postgresql nginx
   sudo -iu quizblitz pm2 status
   sudo -iu quizblitz pm2 logs quizblitz-api --lines 100
   curl --fail https://api.example.com/api/health
   ```

## Step 13: Repeat the Lambda + API Gateway practical

1. In **Lambda → Create function**, choose author from scratch, name it `QuizBlitzHello`, and select a Python runtime.
2. Replace the sample code with [`lambda/handler.py`](lambda/handler.py). Set the handler to `handler.lambda_handler`, deploy, and test it in Lambda.
3. In **API Gateway → Create API → HTTP API**, create a Lambda integration for `QuizBlitzHello`, add route `GET /hello`, and deploy to a stage such as `prod`.
4. Open the invoke URL plus `/hello` and confirm it returns JSON. This endpoint demonstrates the practical independently; it does not replace the app's Express API or Socket.IO. See [AWS Lambda proxy integration for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html).

## Step 14: Repeat the S3 practical

To repeat the classroom S3 exercises separately from the hosted frontend, create a bucket in **S3 → Create bucket**, enable versioning under **Properties**, then upload and replace a sample file to inspect its object versions. The public S3 static website endpoint is optional for the classroom exercise; QuizBlitz itself is hosted on Amplify.

## Step 15: Repeat SNS and SQS practicals

**SNS email:** Open **SNS → Topics → Create topic**, choose **Standard**, and name it `QuizBlitzEmailTopic`. Create an **Email** subscription with your address, then open the confirmation email and click its confirmation link.

**SQS messages:** Open **SQS → Create queue**, choose **Standard**, and name it `QuizBlitzLabQueue`. Open **Send and receive messages**, send a sample message, poll for messages, inspect the body, then delete the message.

These are standalone practical exercises. The current app does not publish finished-game events to SNS/SQS. To add a real game notification/analytics feature, implement an event publisher after the game result commits, then process it through SNS/SQS/Lambda. Do not include passwords, JWTs, or player tokens in messages.

## Troubleshooting

- **Session Manager does not connect:** Confirm `QuizBlitzEc2Role` is attached, `AmazonSSMManagedInstanceCore` is on the role, and the instance has outbound internet access.
- **SSH times out:** Confirm inbound TCP 22 is limited to your current public IP, use the correct `.pem` file, and connect as `ubuntu`.
- **API health returns 502:** Check `sudo -iu quizblitz pm2 status`, PM2 logs, `curl http://127.0.0.1:4000/api/health`, and `sudo nginx -t`.
- **CORS errors:** Set `CLIENT_ORIGIN` to the exact site origin (including `https://` and any `www`), then restart PM2 with `--update-env`.
- **Socket reconnects:** Confirm the API is reachable on 443 and Nginx's `/socket.io/` location still forwards the `Upgrade` and `Connection` headers.
- **Database connection refused:** Check `sudo systemctl status postgresql`, the `DATABASE_URL` in `server/.env`, and that migrations completed. Do not open port 5432.
- **Amplify build fails:** Open the branch's build log. Confirm the app root is `client`, `amplify.yml` is at the repository root, `AMPLIFY_MONOREPO_APP_ROOT` is `client`, and `package-lock.json` is committed.
- **SPA refresh shows a 404:** Confirm the Amplify rewrite rule sends route requests to `/index.html` with status 200.
- **API requests fail in the browser:** Confirm Amplify has the right build-time `VITE_API_URL`, `CLIENT_ORIGIN` exactly matches the Amplify/custom domain, and the API certificate is valid.

## Cleanup after the lab

Delete the Amplify app, optional CodeBuild project, lab S3 bucket and its versions, API Gateway and Lambda resources, SNS subscription/topic, and SQS queue. Terminate the EC2 instance, release the Elastic IP, and remove unused IAM roles and security groups. Back up any data you want to keep before deleting it.
