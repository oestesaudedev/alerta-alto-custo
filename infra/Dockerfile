# Imagem base da fase 2: Node 18 + poppler + tesseract-por.
# A API NestJS (fase 3) será copiada/buildada em cima desta base.
FROM node:18-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-por \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV OCR_TMP_DIR=/tmp/ocr-extracao \
    PORT=3010 \
    NODE_ENV=production

RUN mkdir -p /tmp/ocr-extracao /app
WORKDIR /app

# Placeholder até a fase 3: só valida binários na build
RUN node -v \
  && pdftoppm -v \
  && tesseract --list-langs | grep -q por

EXPOSE 3010

# Substituído na fase 3 por: CMD ["node", "dist/main.js"]
CMD ["node", "-e", "console.log('Infra OK — aguarde deploy da API NestJS (fase 3)'); process.exit(0)"]
