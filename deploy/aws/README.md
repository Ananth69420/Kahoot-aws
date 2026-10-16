# QuizBlitz on AWS

This walkthrough adapts the AWS practicals to QuizBlitz. It keeps the real-time game server on EC2 and uses S3 + CloudFront for the frontend. Follow the numbered steps in order. The existing two-EC2 guide in the root README remains available if you want the frontend on EC2 exactly like the classroom full-stack exercise.

## Before you start

You need an AWS account, a source repository CodeBuild can reach (GitHub or CodeCommit), and ideally a domain name for HTTPS. The current workspace has no AWS CLI or AWS credentials, so these are console and instance instructions; they do not create resources automatically. AWS resources can incur charges. Use one Region for EC2, S3, CodeBuild, Lambda, API Gateway, SNS, and SQS. CloudFront is global, and its ACM certificate must be requested in `us-east-1`.

The commands below target Ubuntu 24.04, matching the existing EC2 deployment guide. Your classroom EC2 practical used Amazon Linux (`dnf`) and the `ec2-user` account; on Ubuntu use `apt` and `ubuntu` instead. Do not mix commands from the two distributions.

## Recommended production shape

```text
Players and hosts
   | HTTPS
CloudFront ---- private S3 bucket (React/Vite files)
   |
   +---- api.example.com:443 ---- EC2 (Nginx -> Express + Socket.IO)
                                      |
                                  PostgreSQL

CodeBuild builds the client and publishes it to S3, then invalidates CloudFront.
API Gateway -> Lambda is a separate small serverless endpoint for the lab exercise.
SNS -> SQS -> Lambda is an optional asynchronous event pipeline.
```

### Service choices

| Lab service | QuizBlitz use |
| --- | --- |
| EC2 | One Ubuntu instance runs the Node API, Socket.IO, Nginx, and PostgreSQL. Keep one server process because live rooms and timers are in memory. |
| SSH/SCP | Initial setup and emergency administration only. Restrict SSH to your current public IP; prefer Systems Manager Session Manager for routine access. |
| Apache/httpd | Optional reverse proxy in place of Nginx. The included configuration uses Nginx and forwards WebSocket upgrade headers. |
| Security Groups | Allow backend TCP 443 from the internet. Allow TCP 22 only from an administrator `/32`, or omit it when using Session Manager. Keep 4000 and 5432 private/closed. |
| IAM | Give EC2 an instance profile for Systems Manager. Give CodeBuild its own role scoped to the site bucket and CloudFront distribution. Do not put IAM user keys on EC2 or in `.env`. |
| S3 | Host the built frontend in a private bucket with versioning enabled. CloudFront Origin Access Control (OAC) is the only reader. |
| CodeBuild | Build the Vite client and publish `client/dist` to S3. See `buildspec.yml`. |
| API Gateway + Lambda | A separate `/hello` endpoint is a clean way to demonstrate the lab's API Gateway/Lambda flow. Keep app REST and Socket.IO on EC2. |
| SNS + SQS | Optional asynchronous pipeline for future `game-finished` events (for example, reporting/analytics). Add a publisher after a game is committed, then fan out through SNS to SQS and process with Lambda. |

API Gateway's WebSocket API is not a drop-in Socket.IO server: Socket.IO uses its own handshake, event framing, rooms, and reconnect behavior. Proxying the live game through API Gateway would require replacing/reworking the game transport. For this app, Nginx on EC2 should continue forwarding `/socket.io/` directly to Node.

## One-time setup

1. Choose a Region and create a VPC (or use the default VPC for a lab). Launch Ubuntu 24.04 LTS for the API host. Allocate an Elastic IP and point `api.example.com` to it.
2. Configure the API instance security group: TCP 443 from `0.0.0.0/0` and `::/0` if IPv6 is enabled; TCP 22 from your own public IP `/32` only if needed. Do not add 4000 or 5432 inbound rules.
3. Attach an EC2 IAM role with `AmazonSSMManagedInstanceCore` for Session Manager. Attach no broad S3 or administrator permissions.
4. Follow the root README's backend setup on this instance: local PostgreSQL, Node LTS, PM2 single fork, Nginx, HTTPS, migrations, and `server/.env`. Set `CLIENT_ORIGIN` to the CloudFront/site domain and `VITE_API_URL` to `https://api.example.com`.
5. Create a dedicated private S3 bucket for the client artifacts. Enable bucket versioning and block all public access. Create a CloudFront distribution with the S3 origin, Origin Access Control (OAC), HTTPS redirect, and the SPA fallback so client routes serve `/index.html` (for example, map 403 and 404 responses to `/index.html` with response code 200). Add a bucket policy allowing `s3:GetObject` only from that distribution. Do not enable S3 static website hosting; the origin should remain private.
6. If using a custom site domain, request an ACM certificate in `us-east-1` for the CloudFront distribution, validate DNS, and add the alternate domain name. Point the site DNS record to CloudFront. The API certificate is separately issued in its own region and installed on the API host (or terminate TLS with an AWS load balancer).
7. Create a CodeBuild project using this repository as its source. Set its build environment variables:

   - `SITE_BUCKET`: the private frontend bucket name
   - `CLOUDFRONT_DISTRIBUTION_ID`: the distribution ID
   - `VITE_API_URL`: `https://api.example.com`

   Its service role needs only read access to the source artifact, `s3:ListBucket` / `s3:PutObject` / `s3:DeleteObject` on this dedicated site bucket, and `cloudfront:CreateInvalidation` on this distribution. Set `CLOUDFRONT_DISTRIBUTION_ID` as a project environment variable to enable the buildspec's invalidation step.

## Step-by-step hosting walkthrough

### Step 1: Prepare a source repository

CodeBuild builds from a Git repository; it cannot build directly from this local folder. Push the QuizBlitz project to a repository you control. Keep `.env` files, private keys, database passwords, and JWT secrets out of Git. Confirm `package-lock.json` is included.

### Step 2: Create the EC2 access role

In AWS Console, open **IAM → Roles → Create role**. Choose **AWS service → EC2**, attach `AmazonSSMManagedInstanceCore`, and name the role `QuizBlitzEc2Role`. This permits Systems Manager Session Manager access without a long-lived IAM access key on the server. Do not use the classroom's broad AdministratorAccess policy for the app server.

### Step 3: Launch the backend EC2 instance

In **EC2 → Launch instance**:

1. Name it `quizblitz-api`, choose Ubuntu Server 24.04 LTS, and select a small instance type suitable for a class/demo workload.
2. Create/select a security group. Allow inbound TCP 80 and 443 from the internet. Allow TCP 22 only from **My IP** if you plan to use SSH; otherwise use Session Manager. Do not open 4000 or 5432.
3. Attach `QuizBlitzEc2Role`. Create/download a key pair only if you will use SSH.
4. Launch it, allocate an Elastic IP in **EC2 → Elastic IPs**, and associate it with this instance. Point `api.example.com` to the address if you own a domain.

### Step 4: Install the backend prerequisites

Connect using **EC2 → Instances → Connect → Session Manager** (or SSH using the key pair). Then install PostgreSQL, Nginx, Git, and system tools:

```bash
sudo apt update
sudo apt install -y postgresql nginx git curl build-essential snapd unzip
sudo adduser --disabled-password --gecos "" quizblitz
sudo install -d -o quizblitz -g quizblitz /var/www/quizblitz
```

Install Node 24 LTS and PM2 as the `quizblitz` user, following the commands in the root README's **Backend instance: PostgreSQL, Node, PM2, and API** section. Use a read-only deploy key to clone your repository, or SCP the project files from your computer if this is a classroom-only run.

### Step 5: Create the database and configure the API

Create the local PostgreSQL role/database as described in the root README. Keep PostgreSQL on loopback. In `server/.env`, configure `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=4000`, `DATABASE_URL`, a randomly generated `JWT_SECRET`, `DATABASE_SSL=false`, and `TRUST_PROXY=true`. Set `CLIENT_ORIGIN` to the exact frontend origin after creating CloudFront in Step 8. Keep this file private (`chmod 600 server/.env`) and out of Git.

From the repository root on the instance, install and migrate:

```bash
npm ci
npm --workspace server run db:migrate
```

Start the API with the single-process PM2 config, enable PM2 on reboot, and install `deploy/backend.nginx.conf` as shown in the root README. Check `curl http://127.0.0.1:4000/api/health` returns `{"status":"ok"}` before setting up HTTPS. Do not expose port 4000 in the security group.

### Step 6: Set up HTTPS for the API

For a custom domain, point `api.example.com` to the backend Elastic IP, wait for DNS to resolve, then follow the root README's Certbot steps to install a TLS certificate for that name. The API URL used by the browser must be HTTPS because the hosted frontend is HTTPS. If you do not own a domain yet, pause here and obtain one or use an HTTPS load balancer with an ACM certificate; a plain HTTP API will be blocked by browsers when called from the HTTPS CloudFront site.

### Step 7: Create the frontend bucket

In **S3 → Create bucket**, choose a globally unique name such as `quizblitz-site-yourname-region`, keep **Block all public access** enabled, and create it. Open **Properties → Bucket Versioning → Edit → Enable**. Do not enable S3 static website hosting for this setup: CloudFront will read the private bucket using OAC. The classroom public website endpoint is useful for the S3 exercise, but the HTTPS CloudFront path is the safer hosting setup for this app.

### Step 8: Create CloudFront for the site

In **CloudFront → Create distribution**, choose the S3 bucket as the origin and create an Origin Access Control when prompted. Keep the bucket private and let CloudFront update or provide the bucket policy so only that distribution can read objects. Set viewer protocol policy to **Redirect HTTP to HTTPS**. Configure the SPA fallback so 403 and 404 responses return `/index.html` with response code 200; this makes routes such as `/dashboard` and `/join` load on refresh.

For a custom domain, request/validate an ACM certificate in `us-east-1`, add the domain as an alternate domain name, and point its DNS record to the distribution. Otherwise use the CloudFront `*.cloudfront.net` hostname as the site origin for `CLIENT_ORIGIN`.

### Step 9: Create the CodeBuild project

In **CodeBuild → Build projects → Create build project**, choose a project name, connect the source repository and its `main` branch, and use a managed Linux image with Node.js 22. Set buildspec path to `deploy/aws/buildspec.yml`. Create/choose a CodeBuild service role and grant only source read access, the specific site bucket's list/write/delete access, and CloudFront invalidation on the specific distribution.

Add these environment variables in the project:

```text
SITE_BUCKET=your-private-site-bucket
VITE_API_URL=https://api.example.com
CLOUDFRONT_DISTRIBUTION_ID=your-distribution-id
```

Choose **Start build** and inspect **Build logs**. A successful build writes `client/dist` to S3 and invalidates the CloudFront HTML entry points. If the build fails, fix the first failing command in the log before continuing.

### Step 10: Test the hosted app

Open the CloudFront domain (or your site domain). Confirm the site loads and direct refresh works on `/dashboard`, `/history`, and `/join`. Sign up, create a quiz, open the host game screen, and join from another device. Complete a question and finish the game. Check the API health URL, browser console for CORS/mixed-content errors, and PM2 logs on EC2. The finished game should appear in history.

### Step 11: Repeat the Lambda + API Gateway practical

Create a Python Lambda in the same Region named `QuizBlitzHello`. Use `deploy/aws/lambda/handler.py` as its code (handler name `handler.lambda_handler`), deploy it, and run the Lambda console test. Then open **API Gateway → Create API → HTTP API**, add an integration to that Lambda, create route `GET /hello`, and deploy to a stage such as `prod`. Open the Invoke URL plus `/hello` and confirm the JSON response. This demonstrates the practical independently; it does not replace the Express API or Socket.IO server. See [AWS Lambda proxy integration for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html).

### Step 12: Repeat SNS email and SQS queue practicals

For SNS, create a Standard topic, add an email subscription, and confirm it from the email before expecting notifications. For SQS, create a Standard queue, send a sample message in **Send and receive messages**, poll it, inspect it, and delete it when done. These standalone exercises do not currently send QuizBlitz game data. Connecting them to completed games requires adding an application event publisher and a consumer; the safe design is documented below.

### Step 13: Build cleanup into the lab

When finished, delete the CodeBuild project, CloudFront distribution (disable it and wait for deployment first), S3 objects and bucket, API Gateway/Lambda resources, SNS subscription/topic, SQS queue, and EC2 instance. Release unused Elastic IPs and delete unused security groups and IAM roles. Keep an S3 backup of anything you need before deleting it.

## Deploy the frontend with CodeBuild

The included buildspec builds the client and syncs it to S3. In CodeBuild, use the repo root as the buildspec path. Trigger a build after pushing a change. CloudFront caches immutable hashed assets; the build removes obsolete files and invalidates the HTML entry point.

You can run the same commands locally after configuring AWS CLI credentials with least-privilege access:

```powershell
$env:VITE_API_URL = "https://api.example.com"
$env:SITE_BUCKET = "your-private-site-bucket"
npm ci
npm --workspace client run build
aws s3 sync client/dist "s3://$env:SITE_BUCKET" --delete
aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths "/index.html" "/"
```

## API Gateway and Lambda lab endpoint

The app's core API remains on EC2. To repeat the lab with a useful independent endpoint, create a Python Lambda returning JSON, then expose it through an API Gateway HTTP API at `GET /hello`. Deploy it to a stage and test the invoke URL with `curl`. Keep this endpoint separate from the app's Socket.IO URL and do not put secrets in the Lambda source.

## SNS and SQS extension

The current app has no background job requirement, so SNS/SQS are an extension rather than a dependency for gameplay. A safe integration is: after PostgreSQL commits a finished game's result, publish a small event containing the game ID to SNS; subscribe an SQS queue; have Lambda read the result from the database/service and write a report or aggregate to S3. Configure a dead-letter queue, encryption, retention, and least-privilege resource policies. Do not send JWTs, passwords, or full player tokens in queue messages.

## Verify

1. `https://api.example.com/api/health` returns `{"status":"ok"}`.
2. The CloudFront site loads over HTTPS, and directly opening `/dashboard`, `/history`, and `/join` serves the SPA.
3. Sign in, create a quiz, and host a game from a second device. Join with a player and complete a question; confirm the Socket.IO connection remains connected and the finished result appears in history.
4. In browser developer tools, confirm API and Socket.IO requests use `https://api.example.com` / `wss://api.example.com` and that there are no CORS or mixed-content errors.
5. Trigger CodeBuild and confirm the new build is visible at the CloudFront URL after invalidation.
6. Separately invoke the API Gateway `/hello` endpoint and confirm its Lambda response.

## Cost and access notes

This design still has always-on EC2 compute and a public IPv4 address. S3, CloudFront, CodeBuild, Lambda, API Gateway, SNS, and SQS are usage-based and can incur charges. Review current pricing for the chosen Region, configure a budget alert, and delete resources when finished with a lab. No AWS resources are created by these repository instructions.
