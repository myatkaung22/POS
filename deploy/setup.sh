#!/usr/bin/env bash
# Install OmniMind POS beside existing apps. Does not change sites on :80/:443.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/omnimind-pos}"
APP_PORT="${APP_PORT:-3010}"
PUBLIC_PORT="${PUBLIC_PORT:-8088}"
PUBLIC_URL="${PUBLIC_URL:-http://178.128.81.13:${PUBLIC_PORT}}"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/setup.sh"
  exit 1
fi

echo "Installing OmniMind POS into ${APP_DIR}"
echo "Public URL ${PUBLIC_URL}  (Aurelune on :80/:443 is not changed)"

mkdir -p "${APP_DIR}"
rsync -a --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude dist-server \
  --exclude .git \
  --exclude prisma/dev.db \
  --exclude prisma/prod.db \
  --exclude .env \
  --exclude uploads \
  ./ "${APP_DIR}/"

cd "${APP_DIR}"

if [[ ! -f .env ]]; then
  JWT="$(openssl rand -hex 32)"
  cat > .env <<EOF
DATABASE_URL="file:./prod.db"
JWT_SECRET="${JWT}"
PORT=${APP_PORT}
HOST=127.0.0.1
PUBLIC_URL=${PUBLIC_URL}
NODE_ENV=production
EOF
  echo "Wrote ${APP_DIR}/.env"
fi

npm install
npx prisma generate
npx prisma db push
npx vite build

mkdir -p uploads/menu
chown -R www-data:www-data "${APP_DIR}"
chmod 750 "${APP_DIR}"
chmod 640 "${APP_DIR}/.env"

NODE_BIN="$(command -v node)"
NPX_BIN="$(command -v npx)"
if [[ -z "${NPX_BIN}" ]]; then
  echo "Node.js / npx not found. Install Node 20+ then re-run."
  exit 1
fi

cat > /etc/systemd/system/omnimind-pos.service <<EOF
[Unit]
Description=OmniMind POS (4 Corner)
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=HOME=${APP_DIR}
Environment=PATH=/usr/local/bin:/usr/bin:${PATH}
ExecStart=${NPX_BIN} tsx --env-file=.env server/index.ts
Restart=always
RestartSec=3
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now omnimind-pos

install -m 644 deploy/nginx-omnimind-pos.conf /etc/nginx/sites-available/omnimind-pos
ln -sfn /etc/nginx/sites-available/omnimind-pos /etc/nginx/sites-enabled/omnimind-pos
nginx -t
systemctl reload nginx

if command -v ufw >/dev/null 2>&1; then
  ufw allow "${PUBLIC_PORT}/tcp" comment "OmniMind POS" || true
fi

echo
echo "POS is on ${PUBLIC_URL}"
echo "Existing nginx sites on ports 80 and 443 were not modified."
echo "Optional first login seed (wipes THIS app db only): cd ${APP_DIR} && sudo -u www-data npx tsx --env-file=.env prisma/seed.ts"
