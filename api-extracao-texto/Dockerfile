FROM node:18-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:18-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-por \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3010 \
    OCR_TMP_DIR=/tmp/ocr-extracao \
    API_TOKEN=dev-change-me

RUN mkdir -p /tmp/ocr-extracao
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 3010
CMD ["node", "dist/main.js"]
