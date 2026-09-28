FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-por \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && pdftoppm -v \
  && tesseract --list-langs | grep -q por

WORKDIR /app
# API_TOKEN e SFTP_* vêm do .env (env_file do compose), nunca da imagem
ENV NODE_ENV=production \
    PORT=3010 \
    OCR_TMP_DIR=/tmp/ocr-extracao

RUN mkdir -p /tmp/ocr-extracao && chown node:node /tmp/ocr-extracao
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3010)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
