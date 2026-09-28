# Fase 2 — Infra da API (Linux)

Entrega: host preparado com **Node 18+**, **poppler-utils**, **tesseract-ocr** + **tesseract-ocr-por** e **pm2**, pronto para receber a API NestJS na fase 3.

| Arquivo | Uso |
|---------|-----|
| [setup-linux.sh](setup-linux.sh) | Provisiona Ubuntu/Debian (apt + NodeSource + pm2 + dirs) |
| [verify-infra.sh](verify-infra.sh) | Checa Node ≥ 18, pdftoppm, tesseract `por`, pm2 |
| [Dockerfile](Dockerfile) | Imagem bookworm-slim com as mesmas deps (dev/parity) |
| [docker-compose.yml](docker-compose.yml) | Sobe o container de infra localmente |
| [ecosystem.config.cjs](ecosystem.config.cjs) | Template pm2 (ativado na fase 3) |

## Opção A — Servidor Linux (produção / homolog)

```bash
# no host Ubuntu/Debian
sudo bash infra/setup-linux.sh
bash infra/verify-infra.sh   # deve sair com exit 0
```

O script cria:
- usuário sistema `ocr`
- app em `/opt/api-extracao-texto`
- temp OCR em `/var/tmp/ocr-extracao`

## Opção B — Docker (dev / validação sem VM)

```bash
docker compose -f infra/docker-compose.yml up --build
```

A build falha se `pdftoppm` ou o idioma `por` do Tesseract não estiverem ok.

## Rede / Protheus

- Desenvolvimento: API na porta **3010** (a 3000 já é usada pelo `movianexo-api`).
- Produção: API em `10.1.5.14`, porta **6177** (pm2 `--env production` ou Docker com `API_HOST_PORT=6177`).
- A URL fica no fonte do Protheus, escolhida pelo ambiente: `CYWSXT_PROD` chama `http://10.1.5.14:6177/extrair-sftp`; qualquer outro chama `http://localhost:3010/extrair-sftp` (API na mesma máquina do AppServer).
- pm2: `API_TOKEN` fica só no `.env`; o `ecosystem.config.cjs` não o define, porque variável do pm2 venceria o `.env`.
- A máquina da API precisa de saída para o SFTP (`SFTP_HOST:SFTP_PORT`, hoje porta `1151`).
- Token (`API_TOKEN`) padrão de desenvolvimento: `dev-change-me` (definir valor forte em produção).
- Não expor a porta na internet.

## Docker com a API (fase 3)

```bash
docker compose -f infra/docker-compose.yml up -d --build
# sobe api-extracao-texto em http://localhost:3010
# produção (porta que o Protheus CYWSXT_PROD chama): API_HOST_PORT=6177
```

Testes da fase 4: `api-extracao-texto/test/e2e/rodar-fase4.ps1` (ver README da API).

## Checklist pós-setup

- [ ] `node -v` ≥ 18
- [ ] `pdftoppm -v` OK
- [ ] `tesseract --list-langs` contém `por`
- [ ] `pm2 -v` OK
- [ ] Host / IP anotado no checklist (`levantamento/01-checklist-config.md` → `__API_URL`)

## Fora de escopo desta fase

- Código NestJS (`api-extracao-texto/`) — fase 3
- Testes curl com PDF/JPG — fase 4
