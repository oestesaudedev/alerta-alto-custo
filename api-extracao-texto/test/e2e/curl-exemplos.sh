#!/usr/bin/env bash
# Fase 4 com curl (host Linux com a API rodando).
# Uso: read -rs API_TOKEN && export API_TOKEN && bash test/e2e/curl-exemplos.sh [arquivo...]
# Sem argumentos, envia as 3 amostras de test/e2e/amostras/. Precisa da API com EXTRAIR_BASE64=true.
set -euo pipefail

API_URL="${API_URL:-http://localhost:3010/extrair}"
API_TOKEN="${API_TOKEN:?defina API_TOKEN com o valor do .env da API}"
DIR="$(cd "$(dirname "$0")" && pwd)/amostras"

if [[ $# -eq 0 ]]; then
  set -- "$DIR/texto.pdf" "$DIR/imagem.jpg" "$DIR/escaneado.pdf"
fi

for arq in "$@"; do
  echo "==> $(basename "$arq")"
  body="$(mktemp)"
  printf '{"nome":"%s","conteudoBase64":"%s"}' "$(basename "$arq")" "$(base64 -w0 "$arq")" > "$body"
  curl -s -X POST "$API_URL" \
    -H "Authorization: Bearer $API_TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary "@$body"
  echo
  rm -f "$body"
done
