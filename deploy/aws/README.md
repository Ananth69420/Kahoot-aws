# QuizBlitz AWS Deployment: One EC2 Instance

This guide deploys the complete QuizBlitz app on **one Ubuntu EC2 instance**. It intentionally does not use Amplify or CloudFront: with no domain, keeping the website and API on the same EC2 host avoids the separate HTTPS API setup those services would require.

- Nginx serves the built React website.
- Nginx sends `/api/` and `/socket.io/` requests to the Node.js server.
- Node.js runs the REST API and live games through Socket.IO.
- PostgreSQL stores users, quizzes, and game history on the same instance.

You will open the app at the instance's public IPv4 address, for example `http://203.0.113.25`. This is the simplest setup for a short classroom evaluation and does not require Amplify, CloudFront, a domain, or Certbot. It uses HTTP, so use demo credentials and do not use this setup for real users or sensitive data.

Read the steps in order. Commands marked **On your computer** run in Windows PowerShell. Commands marked **On EC2** run in the EC2 terminal. Do not paste example values with angle brackets; replace each placeholder with your actual value.

## Before you begin

You need:

- An AWS account and this QuizBlitz project on your Windows computer.
- Git installed locally, and the project changes committed to a Git repository.
- An EC2 SSH key pair downloaded as a `.pem` file. AWS will not let you download that private key again later.
- The public repository URL, or the owner/name of your private GitHub repository.

For a small evaluation, use Ubuntu Server 24.04 LTS on an instance with at least 2 GiB of memory (for example, `t3.small` where available) and a 20 GiB `gp3` root disk. EC2, storage, and public IPv4 addresses can incur charges. Review the current estimate shown by AWS before launching.

## Part 1: Create the EC2 instance

1. In AWS Console, choose the Region you will use, then open **EC2 → Instances → Launch instances**.
2. Set **Name** to `quizblitz`.
3. For **Application and OS Images**, choose **Ubuntu Server 24.04 LTS**, 64-bit x86.
4. Choose an instance type with at least 2 GiB of memory.
5. Under **Key pair (login)**, create a new key pair, choose `.pem`, download it, and remember where you saved it. Choose an existing key only if you still have its `.pem` file.
6. Under **Network settings**, create a security group with these inbound rules:

   | Type | Port | Source |
   | --- | ---: | --- |
   | SSH | 22 | My IP |
   | HTTP | 80 | Anywhere IPv4 (`0.0.0.0/0`) |

   Do not add inbound rules for 4000, 5432, or 443. The browser connects to Nginx on port 80; Nginx and PostgreSQL communicate locally inside the instance.

7. Set storage to at least 20 GiB `gp3`.
8. Launch one instance. Wait until its state is **Running** and both status checks pass.
9. On the instance details page, copy its **Public IPv4 address**. You will use it in the SSH and browser commands below. The address can change after stopping and starting the instance. An Elastic IP can keep it stable, but is optional and may have a charge.

## Part 2: Connect to Ubuntu

On your computer, open PowerShell and replace the key path and address:

```powershell
ssh -i "$env:USERPROFILE\Downloads\quizblitz-key.pem" ubuntu@YOUR_EC2_PUBLIC_IP
```

For example, if the public IP is `203.0.113.25`, use `ubuntu@203.0.113.25`. The first time, SSH may ask whether to trust the host; type `yes`. If it says the key file cannot be read, check that the path points to the `.pem` you downloaded.

## Part 3: Install PostgreSQL, Nginx, Git, and Node.js

Run these commands in the EC2 terminal:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y postgresql nginx git curl build-essential
sudo systemctl enable --now postgresql nginx
```

Create a separate Linux account for the app and its directory:

```bash
sudo adduser --disabled-password --gecos "" quizblitz
sudo install -d -o quizblitz -g quizblitz /var/www/quizblitz
```

Install Node.js 22 and PM2 for the `quizblitz` account:

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

The prompt should return to `ubuntu@...` after `exit`.

## Part 4: Copy the project onto EC2

Choose **A** if EC2 can clone your GitHub repository. Choose **B** to send the committed project from your computer with SCP.

### A. Clone from GitHub

For a public repository, run on EC2:

```bash
sudo -iu quizblitz
git clone https://github.com/OWNER/REPOSITORY.git /var/www/quizblitz
exit
```

Replace `OWNER/REPOSITORY` with the values from the repository's GitHub page. For a private repository, configure a read-only GitHub deploy key before running `git clone` (GitHub repository **Settings → Deploy keys**); do not paste a password or personal access token into the command line.

### B. Upload the committed project with SCP

This method sends only files tracked by Git, so ignored local `.env` files and `node_modules` are not uploaded. First, on your computer, open PowerShell in the project root (`D:\kahoot-aws`) and create a zip of the current commit:

```powershell
git status
git archive --format=zip --output quizblitz.zip HEAD
```

If `git status` shows changes you need, commit them before making the archive. Then copy the zip to EC2:

```powershell
scp -i "$env:USERPROFILE\Downloads\quizblitz-key.pem" .\quizblitz.zip ubuntu@YOUR_EC2_PUBLIC_IP:/home/ubuntu/quizblitz.zip
```

Back in the EC2 terminal, unpack it and set the app account as owner:

```bash
sudo apt install -y unzip
sudo unzip -q /home/ubuntu/quizblitz.zip -d /var/www/quizblitz
sudo chown -R quizblitz:quizblitz /var/www/quizblitz
```

Do not upload `.env` files or the `.pem` SSH key into the project directory or Git repository.

## Part 5: Create the database

On EC2, create a strong database password from random hexadecimal characters:

```bash
openssl rand -hex 24
```

Copy the output temporarily. Open PostgreSQL's administrator prompt:

```bash
sudo -u postgres psql
```

At the `postgres=#` prompt, replace `PASTE_DATABASE_PASSWORD` with the generated value:

```sql
CREATE ROLE quizblitz LOGIN PASSWORD 'PASTE_DATABASE_PASSWORD';
CREATE DATABASE quizblitz OWNER quizblitz;
\q
```

The `\q` exits PostgreSQL. Keep the password private. PostgreSQL will remain local; do not expose port 5432 in the EC2 security group.

## Part 6: Configure the API

Create the production environment file as the app account:

```bash
sudo -iu quizblitz
cd /var/www/quizblitz
cp server/.env.example server/.env
openssl rand -base64 48
```

Copy the random output for the JWT secret. Edit the environment file:

```bash
nano server/.env
```

Set the file to these values, replacing both password placeholders. For `CLIENT_ORIGIN`, use the public IP from EC2 and keep the `http://` prefix:

```env
NODE_ENV=production
PORT=4000
HOST=127.0.0.1
CLIENT_ORIGIN=http://YOUR_EC2_PUBLIC_IP
DATABASE_URL=postgres://quizblitz:PASTE_DATABASE_PASSWORD@127.0.0.1:5432/quizblitz
DATABASE_SSL=false
TRUST_PROXY=true
JWT_SECRET=PASTE_RANDOM_BASE64_SECRET
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=12
```

In `nano`, save with **Ctrl+O**, press **Enter**, then exit with **Ctrl+X**. Make the file readable only by the app account, install dependencies, and run the database migrations:

```bash
chmod 600 server/.env
npm ci
npm --workspace server run db:migrate
```

If the migration reports an error, stop here and check the database password and `DATABASE_URL` before starting the app.

## Part 7: Build the website

Still in `/var/www/quizblitz` as `quizblitz`, build the React site:

```bash
npm --workspace client run build
exit
```

The website is now in `/var/www/quizblitz/client/dist`. Do not set `VITE_API_URL` for this deployment: the browser will use the same public address for the website, API, and live-game connection.

## Part 8: Start the API with PM2

On EC2, switch to the app account and start the API with the included one-process configuration:

```bash
sudo -iu quizblitz
cd /var/www/quizblitz
pm2 startOrReload deploy/ecosystem.config.cjs --env production --update-env
pm2 status
pm2 save
pm2 startup
```

`pm2 startup` prints a command beginning with `sudo env PATH=...`. Select and copy the **entire command PM2 printed**. Then return to the Ubuntu account and run it:

```bash
exit
```

Paste the copied command at the `ubuntu@...` prompt. It may ask for the Ubuntu sudo password; on an EC2 Ubuntu instance, sudo normally works without one. After the command succeeds, save the process list again as the app account:

```bash
sudo -iu quizblitz
pm2 save
exit
```

Keep the PM2 configuration at one process. The live game rooms and timers are held in memory, so multiple workers would not share the same game state.

## Part 9: Configure Nginx to serve the whole app

The included Nginx file serves the frontend, routes `/api/` to the Node API, and forwards WebSocket connections at `/socket.io/`:

```bash
cd /var/www/quizblitz
sudo cp deploy/backend.nginx.conf /etc/nginx/sites-available/quizblitz
sudo ln -s /etc/nginx/sites-available/quizblitz /etc/nginx/sites-enabled/quizblitz
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

`nginx -t` should report that the syntax is okay and the test is successful. If `ln` says the file already exists, continue to `sudo nginx -t`; do not create a second link with a different name.

## Part 10: Open the site and check it

On your computer, replace the placeholder with the EC2 public IPv4 address and open:

```text
http://YOUR_EC2_PUBLIC_IP/
```

Check the API health endpoint too:

```text
http://YOUR_EC2_PUBLIC_IP/api/health
```

It should display:

```json
{"status":"ok"}
```

For a full check, create an account, create a quiz with at least two questions, then join its live game from a second browser or phone. The server terminal can show status and logs:

```bash
sudo -iu quizblitz
pm2 status
pm2 logs quizblitz-api --lines 100
exit
sudo systemctl status nginx postgresql
```

## Updating the app later

If you cloned from GitHub, commit and push the changes on your computer. Then on EC2:

```bash
sudo -iu quizblitz
cd /var/www/quizblitz
git pull
npm ci
npm --workspace server run db:migrate
npm --workspace client run build
pm2 restart quizblitz-api --update-env
exit
```

Then reload Nginx in the Ubuntu shell:

```bash
sudo systemctl reload nginx
```

If you used SCP, repeat **Part 4B** to upload a new committed zip, unpack it over the app directory, then repeat the install, migration, frontend build, and PM2 restart commands above. Do not replace `server/.env` when uploading updates.

## Troubleshooting

### The browser cannot connect / times out

- Confirm the EC2 instance is **Running** and use its current **Public IPv4 address**.
- Check the security group allows inbound HTTP port 80 from `0.0.0.0/0`.
- Check Nginx: `sudo systemctl status nginx` and `sudo nginx -t`.

### The page loads but API health fails or shows 502

- Check PM2 and logs by opening an app-account shell first:

  ```bash
  sudo -iu quizblitz
  pm2 status
  pm2 logs quizblitz-api --lines 100
  exit
  ```
- Check the API locally: `curl http://127.0.0.1:4000/api/health`.
- Check Nginx: `sudo nginx -t`.

### PM2 says the app is not online

Check `server/.env` exists, the database is running, and the database password is correct:

```bash
sudo systemctl status postgresql
sudo -iu quizblitz
pm2 logs quizblitz-api --lines 100
exit
```

### Signup says the server is misconfigured

The API requires a `CLIENT_ORIGIN`, `DATABASE_URL`, and a `JWT_SECRET` at least 32 characters long. Confirm the values in `/var/www/quizblitz/server/.env`, then restart PM2 with `--update-env`.

### Nginx shows the default page or 404 on refresh

Confirm `/var/www/quizblitz/client/dist/index.html` exists, the default Nginx site is disabled, and the Nginx configuration test succeeds:

```bash
ls -l /var/www/quizblitz/client/dist/index.html
sudo nginx -t
sudo systemctl reload nginx
```

### Live game does not connect

Confirm the security group still keeps port 4000 closed, Nginx has the `/socket.io/` proxy block, and PM2 is online. The browser should use the same public IP and HTTP origin as the page.

## AWS practicals not needed to run QuizBlitz

The classroom S3 versioning/static website, Lambda/API Gateway, SNS, SQS, and CodeBuild exercises are separate practicals. They are not required by this one-instance QuizBlitz deployment. Do not create extra AWS resources for the app unless your instructor specifically requires those demonstrations.

## Cleanup after the evaluation

When you no longer need the demo, terminate the EC2 instance in **EC2 → Instances**. If you allocated an Elastic IP, release it in **EC2 → Elastic IPs** after the instance no longer needs it. Deleting the instance permanently removes the local PostgreSQL data unless you created a backup. Also delete any separate S3 buckets or other lab resources you created, and check the AWS Billing console for remaining resources.
