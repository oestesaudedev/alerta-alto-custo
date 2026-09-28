# Infra da API (Docker ou Linux + pm2)

Dependências da API: **Node 18+** (a imagem Docker usa Node 22 LTS), **poppler-utils**, **tesseract-ocr** + **tesseract-ocr-por** e, fora do Docker, **pm2**.

| Arquivo | Uso |
|---------|-----|
| [docker-compose.yml](docker-compose.yml) | Compose base (produção): builda `api-extracao-texto/Dockerfile` e sobe a API |
| [docker-compose.dev.yml](docker-compose.dev.yml) | Override de dev: monta `api-extracao-texto/test` em `/app/test` |
| [setup-linux.sh](setup-linux.sh) | Provisiona Ubuntu/Debian (apt + NodeSource + pm2 + dirs) |
| [verify-infra.sh](verify-infra.sh) | Checa Node ≥ 18, pdftoppm, tesseract `por`, pm2 |
| [ecosystem.config.cjs](ecosystem.config.cjs) | Configuração pm2 |

## Opção A — Docker

Pré-requisito: `api-extracao-texto/.env` (copiar de `.env.example`, com `API_TOKEN` forte e senhas do SFTP). Sem ele o compose não sobe.

```bash
# produção (porta que o Protheus CYWSXT_PROD chama)
API_HOST_PORT=6177 docker compose -f infra/docker-compose.yml up -d --build

# dev/testes (porta 3010 + pasta test/ montada)
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d --build
```

- A build falha se `pdftoppm` ou o idioma `por` do Tesseract não estiverem ok.
- A imagem roda como usuário `node` e não contém token nem senhas: tudo vem do `.env` pelo `env_file`.
- `HEALTHCHECK` em `GET /health` (sem token). `docker ps` mostra `healthy`.
- `init: true` encerra `pdftoppm`/`tesseract` junto com a API; logs com rotação (3 × 10 MB).
- Atualizar: `git pull` e o mesmo `up -d --build`. Parar: `docker compose -f infra/docker-compose.yml down`.

Testes da fase 4: `api-extracao-texto/test/e2e/rodar-fase4.ps1` (usa o override de dev; ver README da API).

## Opção B — Servidor Linux + pm2

```bash
# no host Ubuntu/Debian
sudo bash infra/setup-linux.sh
bash infra/verify-infra.sh   # deve sair com exit 0
```

O script cria:
- usuário sistema `ocr`
- app em `/opt/api-extracao-texto`
- temp OCR em `/var/tmp/ocr-extracao`

## Rede / Protheus

- Desenvolvimento: API na porta **3010** (a 3000 já é usada pelo `movianexo-api`).
- Produção: API em `10.1.5.14`, porta **6177** (pm2 `--env production` ou Docker com `API_HOST_PORT=6177`).
- A URL fica no fonte do Protheus, escolhida pelo ambiente: `CYWSXT_PROD` chama `http://10.1.5.14:6177/extrair-sftp`; qualquer outro chama `http://localhost:3010/extrair-sftp` (API na mesma máquina do AppServer).
- pm2: `API_TOKEN` fica só no `.env`; o `ecosystem.config.cjs` não o define, porque variável do pm2 venceria o `.env`.
- A máquina da API precisa de saída para o SFTP (prod: porta `2323`; dev: porta `1151`).
- Token (`API_TOKEN`) padrão de desenvolvimento: `dev-change-me` (definir valor forte em produção).
- Não expor a porta na internet.

## Checklist pós-setup

- [ ] Docker: `docker ps` mostra `api-extracao-texto` como `healthy`
- [ ] pm2: `node -v` ≥ 18, `pdftoppm -v` OK, `tesseract --list-langs` contém `por`, `pm2 -v` OK
- [ ] Host / IP anotado no checklist (`levantamento/01-checklist-config.md` → `__API_URL`)
