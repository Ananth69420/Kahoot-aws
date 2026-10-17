# Deploy QuizBlitz on AWS with Two EC2 Instances

This guide deploys QuizBlitz in the same **frontend instance + backend instance** pattern used in your class. Both instances are in the same AWS VPC and communicate over private IP addresses.

```text
Your browser
    │ HTTP :80
    ▼
Frontend EC2 (Nginx + built React website)
    │ private VPC traffic to BACKEND_PRIVATE_IP:4000
    ▼
Backend EC2 (Node.js API + Socket.IO + PostgreSQL)
```

Nginx on the frontend instance serves the site and forwards `/api/` and `/socket.io/` to Node.js on the backend's private IP. The browser only connects to the frontend. The backend's port `4000` is reachable only from the frontend security group, and PostgreSQL's port `5432` is never public.

This guide uses Ubuntu 24.04 and Nginx. Your lab used Amazon Linux, Apache, and port `8000`; QuizBlitz uses React, Node.js, Socket.IO, and PostgreSQL, so those lab scripts and port numbers do not apply directly.

This is an HTTP classroom demo. Both instances running costs more than one instance. Stop both when you are not using them to stop EC2 compute charges; EBS storage charges continue. Browsers configured to upgrade all HTTP links to HTTPS will still need that setting disabled, because this setup does not create TLS certificates.

## What you need

- This project committed to Git on your Windows computer.
- An AWS account and a Region to use for both EC2 instances.
- One EC2 key pair downloaded as a `.pem` file. You can use the same key pair for both instances.
- A way to connect by SSH from your computer. The instructions use Windows PowerShell.

Do not commit or upload `.env` files, database passwords, JWT secrets, or your `.pem` key.

## Part 1: Create the two security groups

In AWS Console, open **EC2 → Security Groups → Create security group**. Use the default VPC for the Region and create these groups.

### Frontend security group: `quizblitz-frontend-sg`

Add these inbound rules:

| Type | Port | Source |
| --- | ---: | --- |
| HTTP | 80 | Anywhere IPv4 (`0.0.0.0/0`) |
| SSH | 22 | My IP |

### Backend security group: `quizblitz-backend-sg`

Add these inbound rules:

| Type | Port | Source |
| --- | ---: | --- |
| Custom TCP | 4000 | `quizblitz-frontend-sg` |
| SSH | 22 | My IP |

For the port `4000` source, select the frontend security group as the source (AWS may display its `sg-...` ID). Both groups must be in the same VPC. The backend API is not open to all internet addresses. Do not add public inbound rules for `4000` or `5432`. Leave the default outbound rules in place so the instances can install packages.

## Part 2: Launch the backend EC2 instance

1. Open **EC2 → Instances → Launch instances**.
2. Set the name to `quizblitz-backend`.
3. Select **Ubuntu Server 24.04 LTS**, 64-bit x86.
4. Select an instance type with at least 2 GiB of memory. PostgreSQL and Node.js share this instance.
5. Select the key pair you created. Enable **Auto-assign public IP** so you can SSH to it. The API itself will not be publicly reachable through that IP.
6. Choose the same VPC and a subnet in that VPC. Under the firewall/security group option, select **quizblitz-backend-sg**.
7. Use at least a 20 GiB `gp3` root volume.
8. Launch the instance and wait for **Running** and both status checks to pass.
9. Copy both the instance's **Public IPv4 address** (for SSH) and **Private IPv4 address** (for the frontend-to-backend connection). Keep these values labeled; they have different uses.

## Part 3: Prepare the backend instance

From Windows PowerShell, connect to the backend. Replace the key path and public IP:

```powershell
ssh -i "$env:USERPROFILE\Downloads\quizblitz-key.pem" ubuntu@BACKEND_PUBLIC_IP
```

Run on the backend EC2 terminal:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y postgresql git curl build-essential
sudo systemctl enable --now postgresql
sudo adduser --disabled-password --gecos "" quizblitz
sudo install -d -o quizblitz -g quizblitz /var/www/quizblitz
```

Install Node.js 24 and PM2 for the `quizblitz` Linux account:

```bash
sudo -iu quizblitz
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
source ~/.bashrc
nvm install 24
nvm alias default 24
npm install --global pm2
exit
```

## Part 4: Launch the frontend EC2 instance

1. Choose **EC2 → Instances → Launch instances**.
2. Set the name to `quizblitz-frontend`.
3. Select **Ubuntu Server 24.04 LTS**, 64-bit x86.
4. A small instance is enough to serve static frontend files; at least 1 GiB of memory is suitable for this demo.
5. Select the same key pair as the backend. Enable **Auto-assign public IP**.
6. Choose the same VPC as the backend. Under firewall/security group, select **quizblitz-frontend-sg**.
7. Use at least a 12 GiB `gp3` root volume.
8. Launch and wait for **Running** and both status checks to pass.
9. Copy the frontend's **Public IPv4 address**. This is the website URL and the origin value the backend will allow. The proxy target is the backend instance's private IP from Part 2.

## Part 5: Copy the committed project to both instances

This uses a Git archive so it sends only files committed to Git. It does not include ignored `.env` files or local `node_modules`.

### Create the archive on your computer

On your computer, open PowerShell in the project root, for example `D:\kahoot-aws`:

```powershell
git status
git archive --format=zip --output quizblitz.zip HEAD
```

If `git status` shows project changes you need, commit them first, then create the archive again.

### Upload the archive to the backend

```powershell
scp -i "$env:USERPROFILE\Downloads\quizblitz-key.pem" .\quizblitz.zip ubuntu@BACKEND_PUBLIC_IP:/home/ubuntu/quizblitz.zip
```

In the backend SSH session, unpack it and install dependencies:

```bash
sudo apt install -y unzip
sudo unzip -q /home/ubuntu/quizblitz.zip -d /var/www/quizblitz
sudo chown -R quizblitz:quizblitz /var/www/quizblitz
sudo -iu quizblitz
cd /var/www/quizblitz
npm ci
exit
```

### Upload the same archive to the frontend

Open a second PowerShell window, or exit the backend SSH session first:

```powershell
scp -i "$env:USERPROFILE\Downloads\quizblitz-key.pem" .\quizblitz.zip ubuntu@FRONTEND_PUBLIC_IP:/home/ubuntu/quizblitz.zip
```

Connect to the frontend:

```powershell
ssh -i "$env:USERPROFILE\Downloads\quizblitz-key.pem" ubuntu@FRONTEND_PUBLIC_IP
```

On the frontend EC2 terminal, install Nginx and Node.js, then unpack and build:

```bash
sudo apt update
sudo apt install -y nginx curl build-essential unzip
sudo systemctl enable --now nginx
sudo adduser --disabled-password --gecos "" quizblitz
sudo install -d -o quizblitz -g quizblitz /var/www/quizblitz
sudo unzip -q /home/ubuntu/quizblitz.zip -d /var/www/quizblitz
sudo chown -R quizblitz:quizblitz /var/www/quizblitz
sudo -iu quizblitz
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
source ~/.bashrc
nvm install 24
cd /var/www/quizblitz
npm ci
npm --workspace client run build
exit
```

Do not set `VITE_API_URL` for this setup. The browser calls the frontend's own `/api/` and `/socket.io/` paths; frontend Nginx forwards those paths to the backend over the VPC private IP.

## Part 6: Create the PostgreSQL database on the backend

Connect to the backend if you are not already connected. Generate a database password:

```bash
openssl rand -hex 24
```

Copy the generated value temporarily. Open the PostgreSQL administrator prompt:

```bash
sudo -u postgres psql
```

At the `postgres=#` prompt, replace `PASTE_DATABASE_PASSWORD` with that generated value:

```sql
CREATE ROLE quizblitz LOGIN PASSWORD 'PASTE_DATABASE_PASSWORD';
CREATE DATABASE quizblitz OWNER quizblitz;
\q
```

Do not configure PostgreSQL to listen on a public address. Its connection stays on the backend instance at `127.0.0.1:5432`.

## Part 7: Configure and start the backend API

On the backend EC2 terminal, create the app environment file:

```bash
sudo -iu quizblitz
cd /var/www/quizblitz
cp server/.env.example server/.env
openssl rand -base64 48
nano server/.env
```

Copy the random output for `JWT_SECRET`. In `nano`, set these values. Use the **frontend public IP** for `CLIENT_ORIGIN`, and the database password you created above:

```env
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
CLIENT_ORIGIN=http://FRONTEND_PUBLIC_IP
DATABASE_URL=postgres://quizblitz:PASTE_DATABASE_PASSWORD@127.0.0.1:5432/quizblitz
DATABASE_SSL=false
TRUST_PROXY=true
JWT_SECRET=PASTE_RANDOM_BASE64_SECRET
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=12
```

Save with **Ctrl+O**, press **Enter**, then exit with **Ctrl+X**. `HOST=0.0.0.0` lets the frontend instance reach Node over the VPC network; the backend security group limits port `4000` to the frontend security group.

Install dependencies and migrate the database:

```bash
chmod 600 server/.env
npm ci
npm --workspace server run db:migrate
```

Start the API as one PM2 process:

```bash
pm2 startOrReload deploy/ecosystem.config.cjs --env production --update-env
pm2 status
pm2 save
pm2 startup
```

PM2 prints a full `sudo env PATH=...` startup command. Copy it, then return to the Ubuntu account and run it:

```bash
exit
```

Paste the full command PM2 printed. When it succeeds, enable PM2 to restore the saved process list after reboot:

```bash
sudo -iu quizblitz
pm2 save
exit
```

Keep one Node process because active game rooms and timers are stored in memory.

Test the API locally on the backend:

```bash
curl --fail http://127.0.0.1:4000/api/health
```

It should return `{"status":"ok"}`.

## Part 8: Connect frontend Nginx to the backend private IP

On the frontend EC2 terminal, open the included Nginx file:

```bash
cd /var/www/quizblitz
nano deploy/frontend.nginx.conf
```

In **both** places that say `BACKEND_PRIVATE_IP`, replace the placeholder with the backend instance's **Private IPv4 address** from EC2. Do not put the backend public IP here. Save with **Ctrl+O**, Enter, **Ctrl+X**.

Install and enable the Nginx configuration:

```bash
sudo cp deploy/frontend.nginx.conf /etc/nginx/sites-available/quizblitz-frontend
sudo ln -sfn /etc/nginx/sites-available/quizblitz-frontend /etc/nginx/sites-enabled/quizblitz-frontend
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

`nginx -t` must report that the syntax is okay and the test is successful. Nginx serves the React files and proxies the API and WebSocket routes to `http://BACKEND_PRIVATE_IP:4000`.

Test from the frontend instance:

```bash
curl --fail http://BACKEND_PRIVATE_IP:4000/api/health
curl --fail http://127.0.0.1/api/health
```

Replace `BACKEND_PRIVATE_IP` in the first command with the backend's private IP. Both commands should return `{"status":"ok"}`.

## Part 9: Open and test QuizBlitz

From your computer, open the frontend instance's **Public IPv4 address**:

```text
http://FRONTEND_PUBLIC_IP/
```

For example, if the frontend instance shows Public IPv4 address `3.107.128.1`, open `http://3.107.128.1/`. The API health check through the frontend proxy is:

```text
http://FRONTEND_PUBLIC_IP/api/health
```

It should show `{"status":"ok"}`. Then create an account, create a quiz with at least two questions, and join the live game from a second browser/device.

Browsers with **Always use secure connections**, **HTTPS-Only**, or an HTTPS-upgrade setting may change `http://` to `https://`. This deployment does not have TLS, so disable that browser option for the demo or the HTTPS request will fail. Do not change the backend port or open it publicly to solve this.

## Update the IP configuration after stop/start

Stopping preserves installed software, files, and the database on EBS. The backend's private IP normally stays the same across stop/start, but its automatically assigned public IP changes. The frontend's automatically assigned public IP also changes.

After starting either instance, check its current IPs in the EC2 console:

- If the **frontend public IP** changed, update the backend's `CLIENT_ORIGIN` to `http://NEW_FRONTEND_PUBLIC_IP`, then restart PM2 on the backend:

  ```bash
  sudo -iu quizblitz
  nano /var/www/quizblitz/server/.env
  pm2 restart quizblitz-api --update-env
  pm2 save
  exit
  ```

- If the **backend private IP** changed, update both `BACKEND_PRIVATE_IP` values in `/var/www/quizblitz/deploy/frontend.nginx.conf`, copy it again to `/etc/nginx/sites-available/quizblitz-frontend`, then run `sudo nginx -t && sudo systemctl reload nginx` on the frontend.
- Open the site using the current **frontend public IP**.

## Troubleshooting

### Frontend page does not load

Check that the frontend security group allows HTTP port `80` from `0.0.0.0/0`, then on the frontend instance run:

```bash
sudo nginx -t
sudo systemctl status nginx
ls -l /var/www/quizblitz/client/dist/index.html
curl -i http://127.0.0.1/
```

### API health through the frontend returns 502

Check that the backend is running and that Nginx uses the backend **private** IP:

```bash
sudo -iu quizblitz
pm2 status
pm2 logs quizblitz-api --lines 100
exit
```

On the frontend, test the network path:

```bash
curl -i http://BACKEND_PRIVATE_IP:4000/api/health
```

Confirm the backend security group has Custom TCP `4000` with source `quizblitz-frontend-sg`, and the backend `.env` has `HOST=0.0.0.0`.

### Signup or live Socket.IO connection fails

- Backend `CLIENT_ORIGIN` must exactly match the frontend **public** origin, including `http://` and without a trailing slash.
- Restart PM2 after changing `.env`: `pm2 restart quizblitz-api --update-env`.
- Confirm frontend Nginx has the `/socket.io/` proxy block and both its `proxy_pass` values use the backend private IP.
- Confirm the browser is on the frontend URL over `http://`, not `https://`.

### Browser reports the site cannot be reached but EC2 checks work

Confirm you are opening the frontend's current public IPv4 address and that the browser hasn't upgraded the address to HTTPS. From PowerShell, `Test-NetConnection FRONTEND_PUBLIC_IP -Port 80` checks whether the public HTTP port is reachable.

## Separate AWS class practicals

S3 bucket versioning/static website hosting, IAM user policies, Lambda, API Gateway, SNS, SQS, and CodeBuild are separate classroom exercises. They are not required for this two-instance QuizBlitz deployment. QuizBlitz's API and live Socket.IO game server remain on the backend EC2 instance.

## Cleanup

When finished, stop both instances to stop compute charges while preserving their EBS data. When you are sure you no longer need the app or its database, terminate both instances. If you created snapshots or other AWS resources for separate practicals, remove those separately. Check the AWS Billing console for any remaining resources.
