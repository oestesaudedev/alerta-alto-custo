# API NestJS — extração de texto (PDF / OCR)

Usada pelo job Protheus `OSMEDALTC` via `POST /extrair`.

## Requisitos

- Node 18+
- `poppler-utils` (`pdftoppm`) — PDF escaneado
- `tesseract-ocr` + `tesseract-ocr-por`
- Ou a imagem Docker de [`infra/`](../infra/README.md)

## Instalação

```bash
cd api-extracao-texto
cp .env.example .env
npm install
npm run build
npm run start:prod
# ou: npm run start:dev
```

Variáveis (`.env`):

| Variável | Padrão | Uso |
|----------|--------|-----|
| `PORT` | `3010` | Porta HTTP |
| `API_TOKEN` | `dev-change-me` | Header `Authorization` (Bearer ou valor puro) |
| `OCR_TMP_DIR` | `./ocr-tmp` | Pasta temporária |
| `PDF_MIN_TEXT_CHARS` | `40` | Abaixo disso, PDF vai para OCR |
| `BODY_LIMIT` | `25mb` | Tamanho máximo do JSON (o Base64 ocupa ~1,37x o arquivo) |
| `SFTP_HOST` | — | Host do SFTP dos anexos (`/extrair-sftp`) |
| `SFTP_PORT` | `22` | Porta do SFTP (Cloud TOTVS: `1151`) |
| `SFTP_USER` | — | Usuário do SFTP |
| `SFTP_PASSWORD` | — | Senha do SFTP. **Só no `.env`** (fora do git) |
| `SFTP_DIR` | `/` | Pasta dos anexos (`/dirdoc/co01/shared/`) |

No Docker, o `infra/docker-compose.yml` lê este `.env` (`env_file`), então token e SFTP valem também para o container.

## Contrato

`POST /extrair`

Headers: `Authorization: Bearer <API_TOKEN>` (ou só o token)  
Body:

```json
{ "nome": "guia.pdf", "conteudoBase64": "<base64>" }
```

Resposta (HTTP 200):

```json
{ "ok": true, "texto": "...", "metodo": "pdf-parse" }
```

ou

```json
{ "ok": false, "erro": "..." }
```

`metodo` indica o caminho usado: `pdf-parse` (PDF com texto), `ocr-pdf` (PDF escaneado) ou `ocr-imagem`.

Erros de validação (campo faltando) voltam com HTTP 400 e token inválido com HTTP 401, ambos no formato `{ ok: false, erro }`.

Comportamento:
- `.pdf` → `pdf-parse`; se texto curto/vazio ou PDF que o pdf.js não abre → `pdftoppm` + Tesseract `por`
- `.jpg/.jpeg/.png/.tif/.bmp` → Tesseract `por`
- Temporários apagados após a requisição

### `POST /extrair-sftp` (usado pelo job Protheus)

Mesmos headers e mesma resposta do `/extrair`. Em vez do conteúdo, recebe só o nome do arquivo (`ACB_OBJETO`):

```json
{ "arquivo": "guia.pdf" }
```

A API baixa `SFTP_DIR/arquivo` do SFTP e aplica a mesma extração.

- Arquivo inexistente: `{ "ok": false, "erro": "arquivo não encontrado no SFTP: /dirdoc/co01/shared/guia.pdf" }`
- Nome com `/` ou `\`: `{ "ok": false, "erro": "nome de arquivo inválido" }`
- Extensão não suportada é recusada antes do download
- Falha de conexão/autenticação no SFTP também volta como `{ ok: false, erro }`

URL no Protheus, definida no fonte pelo ambiente: `CYWSXT_PROD` → `http://10.1.5.14:6177/extrair-sftp` (API em produção na porta 6177); qualquer outro → `http://localhost:3010/extrair-sftp`

## Testes (fase 4)

Em [`test/e2e/`](test/e2e/):

| Arquivo | Uso |
|---------|-----|
| `gerar-amostras.js` | Gera `texto.pdf`, `imagem.jpg` e `escaneado.pdf` em `test/e2e/amostras/` (precisa de `pdftoppm`) |
| `testar-api.js` | Envia as amostras, confere texto e `metodo`, e testa 401/400/extensão inválida |
| `rodar-fase4.ps1` | Windows: sobe a API no Docker, gera as amostras e roda os testes |
| `curl-exemplos.sh` | Linux: envia arquivos com curl |

Windows (na raiz `extracao-dados`):

```powershell
.\api-extracao-texto\test\e2e\rodar-fase4.ps1
```

Linux (API já rodando, com poppler instalado):

```bash
npm run test:amostras
npm run test:e2e                         # API_URL / API_TOKEN por variável de ambiente
bash test/e2e/curl-exemplos.sh           # ou: bash test/e2e/curl-exemplos.sh guia-real.pdf
```

Anexos reais colocados em `test/e2e/amostras/reais/` também são enviados pelo `testar-api.js` (só exibe o texto, sem asserção).

Para testar o download real do SFTP, informe um arquivo que exista em `SFTP_DIR`:

```powershell
docker exec -e SFTP_ARQUIVO="nome-do-arquivo.pdf" api-extracao-texto node test/e2e/testar-api.js
```

## Docker

```bash
docker compose -f ../infra/docker-compose.yml up -d --build
# sobe em http://localhost:3010; outra porta no host: API_HOST_PORT=<porta>
```

## pm2

```bash
# no servidor, após npm run build em /opt/api-extracao-texto
pm2 start ../infra/ecosystem.config.cjs --env production
```
