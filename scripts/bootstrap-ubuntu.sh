#!/usr/bin/env bash
set -Eeuo pipefail

if ! command -v curl >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y curl
fi

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi

pm2 startup systemd -u "$USER" --hp "$HOME"
pm2 save

echo "Bootstrap complete."
