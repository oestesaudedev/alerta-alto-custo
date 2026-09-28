#!/usr/bin/env bash
# Fase 2 — provisiona host Linux para a API NestJS de extração/OCR.
# Uso (Ubuntu/Debian): sudo bash infra/setup-linux.sh
set -euo pipefail

NODE_MAJOR="${NODE_MAJOR:-18}"
APP_USER="${APP_USER:-ocr}"
APP_DIR="${APP_DIR:-/opt/api-extracao-texto}"
TMP_DIR="${TMP_DIR:-/var/tmp/ocr-extracao}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Execute como root: sudo bash $0" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Pacotes do sistema (poppler + tesseract pt-BR)"
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  gnupg \
  poppler-utils \
  tesseract-ocr \
  tesseract-ocr-por

echo "==> Node.js ${NODE_MAJOR}.x (NodeSource)"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/^v//' | cut -d. -f1)" -lt "${NODE_MAJOR}" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

echo "==> pm2 (global)"
npm install -g pm2

echo "==> Usuário e diretórios da API"
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "${APP_USER}"
fi
mkdir -p "${APP_DIR}" "${TMP_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}" "${TMP_DIR}"
chmod 750 "${APP_DIR}"
chmod 770 "${TMP_DIR}"

echo "==> Firewall (opcional): liberar porta 6177 (produção) só na rede interna"
# ufw allow from 10.0.0.0/8 to any port 6177 proto tcp || true

echo "==> Verificação rápida"
bash "$(dirname "$0")/verify-infra.sh"

cat <<EOF

Provisionamento concluído.
Próximos passos (fase 3):
  1. Copiar o projeto NestJS para ${APP_DIR}
  2. npm ci && npm run build (como ${APP_USER})
  3. pm2 start ecosystem.config.cjs --env production
  4. pm2 save && pm2 startup

Porta: o pm2 com --env production sobe na 6177 (Protheus CYWSXT_PROD chama http://10.1.5.14:6177/extrair-sftp).
API_TOKEN e SFTP_* ficam em ${APP_DIR}/.env (chmod 600).
EOF
