#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/quizblitz}"
cd "$APP_DIR"

git pull --ff-only
npm ci
npm --workspace server run db:migrate
pm2 startOrReload deploy/ecosystem.config.cjs --env production --update-env
pm2 save
curl --fail --silent --show-error http://127.0.0.1:4000/api/health
printf '\nBackend deploy complete.\n'
