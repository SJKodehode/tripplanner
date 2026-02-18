#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p logs

if [[ ! -f .env ]]; then
  echo "Missing .env in $ROOT_DIR"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed on the server."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed on the server."
  exit 1
fi

npm ci
npx prisma generate --schema prisma/schema.prisma
npx prisma migrate deploy
npm run build

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

echo "Deployment completed successfully."
