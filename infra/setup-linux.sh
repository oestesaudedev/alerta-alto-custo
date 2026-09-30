#!/usr/bin/env bash
# Fase 2 — provisiona host Linux para a API NestJS de extração/OCR.
# Uso (Ubuntu/Debian): sudo APPSERVER_IP=<ip do AppServer> bash infra/setup-linux.sh
set -euo pipefail

NODE_MAJOR="${NODE_MAJOR:-22}"
APP_USER="${APP_USER:-ocr}"
APP_DIR="${APP_DIR:-/opt/api-extracao-texto}"
TMP_DIR="${TMP_DIR:-/var/tmp/ocr-extracao}"
API_PORT="${API_PORT:-6177}"
APPSERVER_IP="${APPSERVER_IP:-}"

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

echo "==> Firewall: porta ${API_PORT} só para o AppServer (vale para pm2; com Docker use a chain DOCKER-USER)"
if [[ -z "${APPSERVER_IP}" ]]; then
  echo "AVISO: APPSERVER_IP não informado; configure o firewall à mão (implantacao/README.md, passo 1.5)" >&2
elif command -v ufw >/dev/null 2>&1; then
  ufw allow from "${APPSERVER_IP}" to any port "${API_PORT}" proto tcp
  ufw deny "${API_PORT}/tcp"
  if ! ufw status | grep -q '^Status: active'; then
    echo "AVISO: ufw inativo, as regras só valem depois de 'ufw enable' (libere o SSH antes)" >&2
  fi
else
  echo "AVISO: ufw não instalado; restrinja a porta ${API_PORT} ao ${APPSERVER_IP} no firewall do servidor" >&2
fi

echo "==> Verificação rápida"
bash "$(dirname "$0")/verify-infra.sh"

cat <<EOF

Provisionamento concluído.
Próximos passos (fase 3):
  1. Copiar o projeto NestJS para ${APP_DIR}
  2. npm ci && npm run build (como ${APP_USER})
  3. pm2 start ecosystem.config.cjs --env production
  4. pm2 save && pm2 startup

Porta: o pm2 com --env production sobe na 6177 (Protheus CYWSXT_PROD chama http://10.1.5.14:6177/verificar-sftp).
API_TOKEN e SFTP_* ficam em ${APP_DIR}/.env (chmod 600).
EOF
