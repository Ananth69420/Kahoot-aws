#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/quizblitz}"
: "${VITE_API_URL:?Set VITE_API_URL to the public HTTPS API URL before deploying}"
cd "$APP_DIR"

git pull --ff-only
npm ci
VITE_API_URL="$VITE_API_URL" npm --workspace client run build
sudo nginx -t
sudo systemctl reload nginx
printf '\nFrontend deploy complete.\n'
