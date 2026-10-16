# QuizBlitz

QuizBlitz is a real-time multiplayer quiz game built as a two-service monorepo. The React/Vite client and Node API are independently deployable; PostgreSQL runs alongside the backend. The server will also host Socket.IO in a later phase.

## Phase 1: setup, database schema, and authentication

### Architecture and folders

```text
client/                 React + Vite + Tailwind single-page application
  src/lib/api.js         API calls (backend URL comes from VITE_API_URL)
  src/App.jsx            Landing, signup, and login routes
server/                 Express API and PostgreSQL data layer
  src/config/            Validated environment configuration
  src/controllers/       HTTP request handlers
  src/db/                PostgreSQL pool and SQL migrations
  src/middleware/        JWT authentication middleware
  src/routes/            API routes and request validation
  src/services/          Authentication and persistence logic
```

Authentication uses bcrypt password hashes and signed JWTs. PostgreSQL stores account, quiz, question, game, and result tables. API and Socket.IO CORS will share `CLIENT_ORIGIN`. No client or server deployment address is embedded in source.

### Requirements

- Node.js 20 or later and npm
- PostgreSQL 14 or later running locally

### Run locally

1. Create the database and role (choose your own password):

   ```sql
   CREATE ROLE quizblitz WITH LOGIN PASSWORD 'change-me';
   CREATE DATABASE quizblitz OWNER quizblitz;
   ```

2. From the repository root, install dependencies and copy the example env files:

   ```powershell
   npm install
   Copy-Item server/.env.example server/.env
   Copy-Item client/.env.example client/.env
   ```

3. Set `DATABASE_URL` and a random `JWT_SECRET` of at least 32 characters in `server/.env`. Keep `DATABASE_SSL=false` for PostgreSQL on the backend instance (enable it only when connecting to a database configured for TLS). Keep `CLIENT_ORIGIN=http://localhost:5173` for local Vite. Set the API origin in `client/.env`:

   ```env
   VITE_API_URL=http://localhost:4000
   ```

4. Create the tables and start the apps:

   ```powershell
   npm run db:migrate
   npm run dev
   ```

   Client: http://localhost:5173 · API health: http://localhost:4000/api/health

### Verify Phase 1

- Open `/signup`, create an account, and confirm the host studio loads. Inspect browser storage for `quizblitz-token` and `quizblitz-user`.
- Clear those two local-storage entries, then log in at `/login` with the same credentials.
- Submit a duplicate email and confirm a friendly conflict. Try a password shorter than 10 characters; the form and API both reject it.
- Check `GET /api/health` returns `{"status":"ok"}`.
- Check the protected current-user endpoint using the token from browser storage:

  ```powershell
  $token = '<paste token>'
  Invoke-RestMethod http://localhost:4000/api/auth/me -Headers @{ Authorization = "Bearer $token" }
  ```

- Confirm the migration created `users`, `quizzes`, `questions`, `games`, and `game_results`.

### Phase 1 API

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/health` | No | Liveness check |
| `POST /api/auth/signup` | No | `{ "displayName": "Sam", "email": "sam@example.com", "password": "at-least-10-chars" }` |
| `POST /api/auth/login` | No | `{ "email": "sam@example.com", "password": "…" }` |
| `GET /api/auth/me` | Bearer JWT | Returns the authenticated user |

Auth endpoints are rate-limited. JSON bodies are validated, errors have a stable `{ error: { message } }` shape, and security headers are set with Helmet.

## Phase 2: quiz library and builder

The host studio is available at `/dashboard`. Create quizzes with a title, optional cover image, and 1–50 questions. Each question supports 2–4 unique answers, a correct answer, a 5–60 second time limit, and standard/double/no points. Edit replaces a quiz and its question set atomically. Delete hides a quiz from the studio while retaining it for existing game history.

The migration runner applies sorted SQL files once and records them in `schema_migrations`. This phase adds `002_soft_delete_quizzes.sql`; run `npm run db:migrate` again to apply it to an existing Phase 1 database.

### Quiz API

All endpoints require `Authorization: Bearer <JWT>` and are scoped to the signed-in host. `questions` are replaced as a set when using `PUT`.

| Method and path | Purpose |
| --- | --- |
| `GET /api/quizzes` | List the host's active quizzes and question counts |
| `POST /api/quizzes` | Create a quiz and its questions; returns `201` |
| `GET /api/quizzes/:quizId` | Read one owned quiz with ordered questions |
| `PUT /api/quizzes/:quizId` | Update quiz metadata and replace all questions |
| `DELETE /api/quizzes/:quizId` | Soft-delete an owned quiz; returns `204` |

Example create/update body:

```json
{
  "title": "Movie Night",
  "coverImageUrl": "https://example.com/movies.jpg",
  "questions": [
    {
      "text": "Who directed Jaws?",
      "options": ["Steven Spielberg", "George Lucas", "Ridley Scott", "James Cameron"],
      "correctOption": 0,
      "timeLimitSeconds": 20,
      "pointsMode": "standard"
    }
  ]
}
```

### Verify Phase 2

1. Apply migrations with `npm run db:migrate`, then start both apps using `npm run dev`.
2. Log in and open `/dashboard`. Create a quiz with two questions and 2–4 options each.
3. Edit the quiz, change its title and question content, save, and reload. Confirm the changes persisted.
4. Create a second account and try to fetch the first account's quiz by ID; it should return `404`.
5. Delete the quiz from the studio and confirm it disappears from the active list. Its game references remain valid for history.
6. Try an invalid quiz body (for example, one answer option or a time limit over 60 seconds); the API should return `400` with a validation message.

## Environment variables

See `client/.env.example` and `server/.env.example`. In production, set `VITE_API_URL` to the public backend API origin at client build time, set `CLIENT_ORIGIN` to the frontend origin on the backend, and use a strong private `JWT_SECRET`. Do not commit either `.env` file.

## Phase 3: Socket.IO game engine

The server now attaches Socket.IO to the same HTTP server as Express and applies `CLIENT_ORIGIN` to both CORS configurations. Hosts authenticate the socket handshake with the existing JWT; players join without accounts. Game rooms use server-generated six-digit PINs. Quiz content is loaded from PostgreSQL when the room is created, and the server owns question deadlines, answer correctness, scoring, streaks, and result persistence.

Use the host studio at `/game-lab` (signed in) and the mobile player screen at `/join?pin=123456`. The dashboard includes a **Test live game** link. The host lobby displays a QR code, PIN, roster, and player controls. Player tokens are random, scoped per PIN, and stored locally to support refresh/reconnect with the same nickname. Game sound is optional and starts muted.

### Socket event contract

The tables list the event payloads. Server events are scoped to the game room unless marked private; `game:error` is returned to the socket that sent an invalid action.

| Direction | Event | Payload |
| --- | --- | --- |
| Host → server | `host:create-game` | `{ quizId }` |
| Host → server | `host:resume-game` | `{ pin }` |
| Host → server | `host:start`, `host:skip`, `host:next`, `host:end` | `{ pin }` |
| Host → server | `host:kick` | `{ pin, playerId }` |
| Player → server | `player:join` | `{ pin, nickname, playerToken? }` |
| Player → server | `player:answer` | `{ pin, playerToken, optionIndex }` — never a correctness or time claim |
| Player → server | `player:leave` | `{ pin, playerToken }` |
| Server → host | `host:game-created`, `host:game-state` | `{ pin, quizTitle, status, players, question?, results?, leaderboard? }` |
| Server → room | `lobby:players` | `{ pin, players: [{ id, nickname, connected }] }` |
| Server → player | `player:joined` | `{ pin, playerId, nickname, playerToken, reconnected }` |
| Server → player | `player:lobby-state` | `{ pin, players }` |
| Server → room | `game:started` | `{ pin, quizTitle, totalQuestions }` |
| Server → room | `game:question` | `{ pin, questionNumber, totalQuestions, text, options, timeLimitSeconds, pointsMode, playerCount, endsAt }` (no correct answer) |
| Server → player | `player:answer-accepted` | `{ questionNumber, waiting }` |
| Server → room | `game:answer-count` | `{ pin, answeredCount, playerCount }` |
| Server → room | `game:question-results` | `{ pin, questionNumber, text, options, correctOption, answerCounts, answeredCount, playerCount }` |
| Server → player | `player:answer-result` | `{ questionNumber, correct, noAnswer, pointsEarned, streakBonus, totalScore, currentRank, currentStreak }` |
| Server → player | `player:game-summary` | `{ finalRank, finalScore, correctCount, answeredCount, accuracy, bestStreak }` |
| Server → room | `game:leaderboard` | `{ pin, leaderboard: [{ playerId, nickname, score, rank }] }` |
| Server → room | `game:end` | `{ pin, reason, leaderboard }` |
| Server → player | `player:kicked` | `{ pin, message }` |
| Server → room | `host:connection` | `{ connected }` |
| Server → requester | `game:error` | `{ event, code, message }` |

Questions end when the server timer expires or every player has answered. The host advances after the distribution and leaderboard appear. Standard questions award up to 1,000 speed-scaled points, double questions up to 2,000; consecutive correct answers add up to 500 streak points. Wrong and unanswered questions reset the streak. Final scores, rank, counts, best streak, and per-question stats are written to `game_results` when the game ends.

### How to check that it works

1. Start PostgreSQL, run `npm run db:migrate`, then `npm run dev`.
2. Sign in, create a quiz with at least two questions, and open `/game-lab`.
3. Create a room, open the player test link in another browser, and join with a nickname. Confirm both screens show the live roster.
4. Start the game. Submit an answer from the player and confirm the host's answered count changes. Answer from all players to finish early, or wait for the server timer.
5. Confirm the distribution, private player feedback, streak/score, and leaderboard. Advance to the next question, then finish. Check `games.started_at`, `games.ended_at`, and the matching `game_results` row.
6. Refresh the player during the lobby and during a question. It should reconnect with the same nickname; a second player using the same nickname should receive a duplicate-name error.
7. Try starting with no players, submitting a duplicate answer, and submitting an out-of-range option; each should be rejected by the server.

Expected result: the host sees answers arrive live, question results and the leaderboard appear after the timer or when everyone answers, and both host and players reach final standings. Refresh a player browser mid-game to check that its token restores the same player. If the game screen stays on “CONNECTING”, check that the API is running at `http://localhost:4000`, `CLIENT_ORIGIN` is `http://localhost:5173`, and `VITE_API_URL` points to the API. PostgreSQL must be available for room creation and result persistence.

### Phase 4: full host and player game UIs

The host screen now includes a QR-enabled lobby, connected roster and kick controls, timer, answer counts, animated answer distribution, leaderboard, and final podium. The player screen is optimized for phones with large answer targets, timer, score feedback, streak details, and final stats. Sound can be toggled in either screen; animations honor the device's reduced-motion setting.

### Verify Phase 4

Run the Phase 3 flow on a projector-sized host window and one or more phone-sized player windows. Scan the lobby QR code, join with multiple names, test answer feedback and timer expiry, and finish the game. Check that the final player card shows score, rank, accuracy, correct answers, and best streak. Try disabling sound and enabling the operating system's reduced-motion preference.

The storyboard-style light theme is the default. The header switcher changes between light and dark themes; the preference is stored in browser local storage and follows the user across pages on that browser.

Active room state lives in the Node process, while created games and finished results are persisted in PostgreSQL. Run one backend process for this phase; multi-process Socket.IO requires a shared adapter and coordinated timer/state storage.

## Phase 5: game history and leaderboards

Hosts can open **Past games** from their studio to review completed games, replay the final leaderboard, and view per-question response accuracy. The public **Hall of Fame** page ranks the highest individual scores across all finished games. A game stores a quiz snapshot so later quiz edits do not change its historical question report. Apply migration `003_game_quiz_snapshot.sql` to existing databases; newly created games persist this snapshot automatically.

### Phase 5 API

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/history` | Bearer JWT | List the signed-in host's completed games |
| `GET /api/history/:gameId` | Bearer JWT | Read owned game standings and per-question accuracy |
| `GET /api/leaderboards/hall-of-fame` | No | Return the top 50 scores across finished games |

History endpoints only return games owned by the current host. The Hall of Fame includes player nickname, quiz title, score, accuracy, and game date; no host account details are exposed.

### How to check Phase 5

1. Run `npm run db:migrate` and `npm run dev`.
2. Sign in, host and finish a game with at least two players, then open **Past games** from the dashboard.
3. Open the finished game and confirm it shows the final scores, accuracy, streaks, and question-by-question accuracy.
4. Edit the quiz and revisit the report; its saved question text and options should remain the same as during the game.
5. Open `/hall-of-fame` in a signed-out browser and confirm the finished game's scores appear. A signed-in host should get `404` when requesting another host's game ID.

## Phase 6: deploy to two Ubuntu EC2 instances

This is the lab-style deployment using EC2 for both services. For the AWS managed-services variant (private S3 + CloudFront frontend, CodeBuild publishing, IAM roles, and guidance for the API Gateway/Lambda and SNS/SQS lab services), see [deploy/aws/README.md](deploy/aws/README.md).

This topology uses one public frontend instance and one public API/PostgreSQL instance. Browser clients connect directly to `https://api.example.com` for REST and Socket.IO, so the API's HTTPS listener is public. Node listens only on `127.0.0.1:4000` behind Nginx, and PostgreSQL stays local to the backend host. Do not add inbound rules for ports 4000 or 5432.

### 1. DNS, Elastic IPs, and security groups

Launch two Ubuntu 24.04 LTS EC2 instances in the same AWS Region/VPC. Allocate and associate one Elastic IP with each instance, then create DNS A records:

| Name | Points to | Used for |
| --- | --- | --- |
| `quiz.example.com` | Frontend Elastic IP | React/Vite site |
| `api.example.com` | Backend Elastic IP | Express API and Socket.IO |

Create separate security groups with these inbound rules:

| Instance | Port | Source | Reason |
| --- | --- | --- | --- |
| Frontend | TCP 80 | `0.0.0.0/0` (and `::/0` if IPv6 is enabled) | HTTP and ACME certificate validation |
| Frontend | TCP 443 | `0.0.0.0/0` (and `::/0` if IPv6 is enabled) | Public HTTPS site |
| Backend | TCP 80 | `0.0.0.0/0` (and `::/0` if IPv6 is enabled) | HTTP redirect and certificate validation |
| Backend | TCP 443 | `0.0.0.0/0` (and `::/0` if IPv6 is enabled) | Browser API and WebSocket access |
| Both | TCP 22 | Your current public IP `/32`, or omit and use AWS Systems Manager Session Manager | Administration |

Leave TCP 4000 and TCP 5432 closed in both security groups. Keep PostgreSQL bound to loopback on the backend. AWS recommends limiting SSH to known source ranges; security groups are stateful and can reference other groups when private service-to-service access is needed. [AWS security group guidance](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)

Elastic IPs provide stable public IPv4 addresses for these DNS records. Allocate them in the same Region/network border group as the instances, and release any address you stop using. [AWS Elastic IP instructions](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/working-with-eips.html)

### 2. Backend instance: PostgreSQL, Node, PM2, and API

SSH into the backend instance, install system packages, then create a deploy user and app directory:

```bash
sudo apt update
sudo apt install -y postgresql nginx git curl build-essential snapd
sudo adduser --disabled-password --gecos "" quizblitz
sudo install -d -o quizblitz -g quizblitz /var/www/quizblitz
```

Create a database role and database. Generate a URL-safe password with `openssl rand -hex 32`, then use that value in both commands and the connection URL below:

```bash
sudo -u postgres psql
```

```sql
CREATE ROLE quizblitz LOGIN PASSWORD 'paste-the-generated-hex-password';
CREATE DATABASE quizblitz OWNER quizblitz;
\q
```

PostgreSQL's default local-only listener is the correct setting here; do not open port 5432 in the security group or change `listen_addresses` to `*`. [Ubuntu PostgreSQL guide](https://ubuntu.com/server/docs/install-and-configure-postgresql/)

Install Node 24 LTS and PM2 as the `quizblitz` Unix user, not as root:

```bash
sudo -iu quizblitz
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
source ~/.bashrc
nvm install 24
nvm alias default 24
npm install --global pm2
node --version
```

Node 24 is currently an LTS line; use an LTS release for production and check the official release table when upgrading. [Node.js releases](https://nodejs.org/en/about/previous-releases)

Clone the repository into `/var/www/quizblitz` using a read-only Git deploy key, then create `server/.env` from the example and set:

```env
NODE_ENV=production
PORT=4000
HOST=127.0.0.1
CLIENT_ORIGIN=https://quiz.example.com
DATABASE_URL=postgres://quizblitz:URL_SAFE_HEX_PASSWORD@127.0.0.1:5432/quizblitz
DATABASE_SSL=false
TRUST_PROXY=true
JWT_SECRET=replace-with-openssl-rand-base64-48-output
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=12
```

Generate the JWT secret with `openssl rand -base64 48`. Set `DATABASE_URL` to the database password created above. Restrict the env file to the deploy user with `chmod 600 server/.env`. `TRUST_PROXY=true` is needed because Express receives requests through the local Nginx proxy; the app trusts only that one proxy hop. Keep secrets out of Git and logs.

Install dependencies and run migrations once:

```bash
cd /var/www/quizblitz
npm ci
npm --workspace server run db:migrate
```

The optional seed script creates a host and two sample quizzes. Temporarily set `SEED_EMAIL`, `SEED_PASSWORD` (at least 10 characters), and `SEED_DISPLAY_NAME` in `server/.env`, then run `npm --workspace server run db:seed`. Remove those optional values afterward. The script does not replace the password of an existing account and does not duplicate its two active sample quizzes.

Start the one-process API with PM2 and enable restart after reboot:

```bash
pm2 startOrReload deploy/ecosystem.config.cjs --env production --update-env
pm2 save
pm2 startup
```

PM2 prints a `sudo ... pm2 startup ...` command; copy and run that exact command, then run `pm2 save` again as the `quizblitz` user. This app keeps live rooms and timers in memory, so the backend PM2 config deliberately uses one forked process. [PM2 startup and save](https://pm2.keymetrics.io/docs/usage/startup/)

Install the backend Nginx site and check it:

```bash
sudo cp /var/www/quizblitz/deploy/backend.nginx.conf /etc/nginx/sites-available/quizblitz-api
sudo ln -s /etc/nginx/sites-available/quizblitz-api /etc/nginx/sites-enabled/quizblitz-api
sudo nginx -t
sudo systemctl reload nginx
```

The `/socket.io/` location forwards HTTP/1.1 `Upgrade` and `Connection` headers and keeps the connection open longer than a 60-second quiz question. Nginx requires explicitly forwarding those hop-by-hop headers for WebSocket proxying. [NGINX WebSocket proxying](https://nginx.org/en/docs/http/websocket.html)

### 3. Frontend instance: build and Nginx

On the frontend instance, install Nginx, Git, build tools, and snapd, then create the same unprivileged deploy user and app directory:

```bash
sudo apt update
sudo apt install -y nginx git curl build-essential snapd
sudo adduser --disabled-password --gecos "" quizblitz
sudo install -d -o quizblitz -g quizblitz /var/www/quizblitz
```

Install Node 24 LTS with the nvm commands above (skip the PM2 install). Clone the repository to `/var/www/quizblitz` as the `quizblitz` user. Build-time configuration points browser requests at the public API host:

```bash
cd /var/www/quizblitz
npm ci
VITE_API_URL=https://api.example.com npm --workspace client run build
```

Install and reload the Nginx site:

```bash
sudo cp /var/www/quizblitz/deploy/frontend.nginx.conf /etc/nginx/sites-available/quizblitz-web
sudo ln -s /etc/nginx/sites-available/quizblitz-web /etc/nginx/sites-enabled/quizblitz-web
sudo nginx -t
sudo systemctl reload nginx
```

The SPA config falls back to `index.html`, so routes such as `/history` and `/join` work when loaded directly. `VITE_API_URL` is embedded during the build; rebuild after changing the API address. It is a public URL, never a secret.

### 4. HTTPS, deploy scripts, and smoke checks

After both DNS records resolve and HTTP works, install Certbot on each instance and issue its certificate:

```bash
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/local/bin/certbot
sudo certbot --nginx -d api.example.com    # backend instance
sudo certbot --nginx -d quiz.example.com   # frontend instance
sudo certbot renew --dry-run
```

The included scripts update the checkout, install locked dependencies, build or migrate, and reload the relevant service. Run them from the `quizblitz` account after the initial manual setup:

```bash
APP_DIR=/var/www/quizblitz bash deploy/deploy-backend.sh
VITE_API_URL=https://api.example.com APP_DIR=/var/www/quizblitz bash deploy/deploy-frontend.sh
```

Verify the service and complete one live game:

```bash
curl --fail https://api.example.com/api/health
pm2 status
pm2 logs quizblitz-api --lines 100
```

Open `https://quiz.example.com`, sign in, create a quiz, and host a game from another device. Confirm a player can join, the WebSocket stays connected for a full round, and the finished game appears in history. Frontend and backend origins must match `VITE_API_URL` and `CLIENT_ORIGIN` exactly, including `https://` and any `www` prefix.

### Troubleshooting

- **CORS error:** Set `CLIENT_ORIGIN` to the exact browser origin (for example, `https://quiz.example.com`) and restart PM2 with `pm2 restart quizblitz-api --update-env`.
- **WebSocket keeps reconnecting or falls back to polling:** Check that port 443 reaches backend Nginx, `/socket.io/` is not blocked, and the backend Nginx config passes `Upgrade` and `Connection` headers.
- **502 Bad Gateway:** Run `pm2 status`, `pm2 logs quizblitz-api`, `curl http://127.0.0.1:4000/api/health`, `sudo nginx -t`, and inspect `sudo tail -n 100 /var/log/nginx/error.log`.
- **Mixed content:** If the frontend uses HTTPS, set `VITE_API_URL=https://api.example.com` and rebuild. The Socket.IO client then negotiates a secure WebSocket.
- **Database connection refused:** Verify `sudo systemctl status postgresql`, `DATABASE_URL` in `server/.env`, and run `npm --workspace server run db:migrate` again. Never solve this by opening port 5432 publicly.
- **Deploy script cannot run `git pull`:** Ensure the `quizblitz` user owns the checkout and has a read-only deploy key configured for the repository.

## Theme switcher

The light/dark switch is available in the landing, host, editor, history, and live-game headers. It stores the preference in local storage. The desktop host surfaces use outlined paper panels; the dark theme keeps those outlines and changes the page surfaces while retaining the colorful answer palette.

## Project status

- [x] Phase 1 — project setup, database schema, auth API
- [x] Phase 2 — quiz CRUD API and host dashboard
- [x] Phase 3 — Socket.IO game engine
- [x] Phase 4 — full host and player game UIs
- [x] Phase 5 — history and leaderboards
- [x] Phase 6 — two-instance EC2 deployment guide
- [x] AWS managed-services deployment guide and CodeBuild frontend buildspec

The application phases and AWS deployment guides are complete. No AWS resources have been provisioned from this workspace.
