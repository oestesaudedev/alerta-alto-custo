# API NestJS — extração de texto (PDF / OCR)

Usada pelo job Protheus `OSMEDALTC`: `GET /config` informa se a IA está ligada (`IA_HABILITADA`) e, com ela ligada, `POST /verificar-sftp` baixa o anexo do SFTP, extrai o texto e pede ao Claude os medicamentos de alto custo citados. Com a IA desligada, o job alerta só pelos procedimentos da guia e não chama o `/verificar-sftp`. O `POST /extrair-sftp` fica para o fonte anterior do job. O `POST /extrair` e o `POST /verificar` (Base64) existem só para os testes e ficam desligados por padrão (`EXTRAIR_BASE64`).

## Requisitos

- Node 20+ (a imagem Docker usa Node 22 LTS)
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
| `API_TOKEN` | — (obrigatório) | Header `Authorization` (Bearer ou valor puro). A API não sobe com ele vazio, com menos de 32 caracteres ou `dev-change-me` |
| `OCR_TMP_DIR` | `./ocr-tmp` | Pasta temporária. Sobras de uma execução interrompida são apagadas na subida |
| `EXTRACAO_CONCORRENCIA` | `2` | Extrações simultâneas; as demais esperam numa fila de até 20, acima disso `{ ok: false, erro: "API ocupada..." }` |
| `EXTRAIR_BASE64` | `false` | `true` habilita o `POST /extrair` (só testes; o `docker-compose.dev.yml` liga). Desligado, responde 404 e o limite do JSON cai para `2mb` |
| `PDF_MIN_TEXT_CHARS` | `40` | Abaixo disso, PDF vai para OCR |
| `PDF_MAX_PAGINAS` | `30` | Máximo de páginas de PDF escaneado passadas pelo OCR; o resto é ignorado (com aviso no log) para a resposta caber no timeout do job |
| `BODY_LIMIT` | `25mb` | Tamanho máximo do JSON com `EXTRAIR_BASE64=true` (o Base64 ocupa ~1,37x o arquivo) |
| `SFTP_AMBIENTE_PROD` | `CYWSXT_PROD` | Valor do campo `ambiente` do `/extrair-sftp` que usa o SFTP de produção; qualquer outro usa o de dev |
| `SFTP_PROD_HOST` / `SFTP_DEV_HOST` | — | Host do SFTP dos anexos (prod: `oestesaude169995...`, dev: `oestesaude175831...`) |
| `SFTP_PROD_PORT` / `SFTP_DEV_PORT` | `22` | Porta do SFTP (prod: `2323`, dev: `1151`) |
| `SFTP_PROD_USER` / `SFTP_DEV_USER` | — | Usuário do SFTP (`ftp_CYWSXT_prod` / `ftp_CYWSXT_dev`) |
| `SFTP_PROD_PASSWORD` / `SFTP_DEV_PASSWORD` | — | Senha do SFTP. **Só no `.env`** (fora do git) |
| `SFTP_PROD_HOSTKEY` / `SFTP_DEV_HOSTKEY` | — | Impressões digitais do servidor (`SHA256:...`, separadas por vírgula; valores no `.env.example`). Obrigatórias quando o `HOST` do perfil está preenchido. Chave diferente: `{ ok: false, erro: "chave do servidor SFTP ... não confere" }`. Obter: `ssh-keyscan -p PORTA HOST \| ssh-keygen -lf -` |
| `SFTP_DIR` | `/` | Pasta dos anexos (`/dirdoc/co01/shared/`) |
| `IA_HABILITADA` | `false` | `true` liga o Claude (ver [IA](#ia-claude)). O job lê o valor pelo `GET /config`: com `false`, alerta só pelos procedimentos da guia e não envia anexos (o `/verificar-sftp`, se chamado, responde "IA indisponivel") |
| `IA_PROVEDOR` | `anthropic` | Provedor da IA. Hoje só `anthropic`; outro valor impede a subida com `IA_HABILITADA=true` |
| `ANTHROPIC_API_KEY` | — | Chave da Anthropic. Obrigatória com `IA_HABILITADA=true` (a API não sobe sem ela). **Só no `.env`** |
| `IA_MODELO` | `claude-sonnet-5-5` | Modelo do Claude (`claude-haiku-4-5` é mais barato) |
| `IA_TIMEOUT_MS` | `60000` | Tempo máximo da chamada ao Claude, incluindo 1 nova tentativa em 429/5xx |
| `IA_MAX_CHARS` | `100000` | Máximo de caracteres do texto enviados ao Claude. Acima disso a IA lê só o início: `WARN` no log e aviso `texto-cortado` no `/verificar*` |

No Docker, o `infra/docker-compose.yml` lê este `.env` (`env_file`), então token e SFTP valem também para o container.

## Contrato

`POST /extrair` (só com `EXTRAIR_BASE64=true`)

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

### `GET /config` (usado pelo job Protheus)

Mesmos headers (token obrigatório; sem ele, HTTP 401). O job chama uma vez por execução para saber se envia os anexos:

```json
{ "ok": true, "ia": true, "modelo": "claude-sonnet-5-5" }
```

Com `IA_HABILITADA=false`: `{ "ok": true, "ia": false }`. Mudar o valor exige reiniciar a API. Se o job não conseguir ler o `/config` (API fora, token errado, API antiga sem o endpoint), a execução termina sem avançar o `Z_NOTIENCA`.

### `POST /verificar-sftp` (usado pelo job Protheus com a IA ligada)

Mesmos headers. Baixa o anexo do SFTP como o `/extrair-sftp`, extrai o texto e manda ao Claude o texto mascarado e a lista de medicamentos. Devolve os medicamentos achados, sem o texto; o job junta esses achados aos procedimentos de alto custo da guia:

```json
{
  "arquivo": "guia.pdf",
  "ambiente": "CYWSXT_PROD",
  "medicamentos": [{ "codigo": "90000001", "descricao": "INFLIXIMABE 100MG", "termos": ["INFLIXIMABE 100MG", "INFLIXIMABE"] }],
  "mascarar": ["JOAO CARLOS DA SILVA", "00010002000123001"]
}
```

```json
{
  "ok": true, "metodo": "pdf-parse", "modelo": "claude-sonnet-5-5",
  "achados": [
    { "codigo": "90000001", "termo": "INFLIXIMABE", "origem": "ia", "observacao": "IA (alta): nome exato da lista" },
    { "codigo": "90000002", "termo": "STELARA", "origem": "ia", "observacao": "IA (media): nome comercial de ustequinumabe" }
  ],
  "avisos": [{ "tipo": "confianca-baixa", "codigo": "90000003", "observacao": "IA (baixa): ..." }]
}
```

- `medicamentos` é obrigatório e não pode ser vazio (HTTP 400); até 5000 itens, com `descricao` e cada termo de até 1000 caracteres. `mascarar` é opcional (até 20 nomes).
- Só medicamento pedido de forma explícita para o paciente (contexto `solicitado`: "solicito", "prescrevo", receita com posologia, pedido de autorização) chega à classificação. Menções `informativo` (folheto, bula, termo de consentimento, lista de reações adversas), `historico` ("paciente em uso de", uso contínuo, uso anterior, suspenso, alergia; estar em uso não é pedido de cobertura) e `outro` são descartadas na API, sem aviso; o log da API mostra só a contagem.
- Classificação ([`classificacao-ia.ts`](src/extracao/verificacao/classificacao-ia.ts)): confiança `alta` ou `media` vira achado (origem `ia`); `baixa` vira aviso `confianca-baixa`. A confiança mede só a identificação do nome (exato, nome comercial, erro de OCR). Texto maior que `IA_MAX_CHARS` gera o aviso `texto-cortado` (código vazio).
- Falha da IA (timeout, chave inválida, `IA_HABILITADA=false`): `{ "ok": false, "erro": "IA indisponivel: ..." }`. O job trata como falha temporária e retoma a B71 na próxima execução (com a IA desligada ele nem chama este endpoint; o erro só aparece se o flag mudar no meio de uma execução).
- Erros da extração iguais aos do `/extrair-sftp` (`{ ok: false, erro }`), antes de chamar a IA.
- Campos que não existem mais (`ia`, `retornarTexto`, do fonte intermediário do job) são recusados com HTTP 400.

`POST /verificar` faz o mesmo com `nome` + `conteudoBase64` no lugar de `arquivo` + `ambiente` (só com `EXTRAIR_BASE64=true`, para testes), e aceita `retornarTexto: true` para devolver também o `texto`.

### `POST /extrair-sftp` (fonte anterior do job)

Mantido para o fonte anterior do job. Mesmos headers e mesma resposta do `/extrair`. Em vez do conteúdo, recebe o nome do arquivo (`ACB_OBJETO`) e o ambiente do Protheus (`GetEnvServer()`), os dois obrigatórios:

```json
{ "arquivo": "guia.pdf", "ambiente": "CYWSXT_PROD" }
```

A API baixa `SFTP_DIR/arquivo` do SFTP do ambiente (`PROD` quando `ambiente` = `SFTP_AMBIENTE_PROD`, senão `DEV`) e aplica a mesma extração.

- Sem `ambiente`: HTTP 400. O job trata como falha temporária e não descarta o anexo
- Arquivo inexistente: `{ "ok": false, "erro": "arquivo não encontrado no SFTP PROD: /dirdoc/co01/shared/guia.pdf" }`. O job trata como definitivo (procura "encontrado no SFTP")
- Perfil sem credencial no `.env` (ex.: `SFTP_DEV_*` vazio na produção): `{ ok: false, erro: "SFTP DEV não configurado ..." }`, falha temporária no job
- Nome com `/` ou `\`: `{ "ok": false, "erro": "nome de arquivo inválido" }`
- Extensão não suportada é recusada antes do download
- Falha de conexão/autenticação no SFTP também volta como `{ ok: false, erro }`

URL no Protheus, definida no fonte pelo ambiente: `CYWSXT_PROD` → `http://10.1.5.14:6177/verificar-sftp` (API em produção na porta 6177); qualquer outro → `__URL_DEV` + `/verificar-sftp`

### IA (Claude)

O `/verificar*` sempre chama o Claude (acima). Os endpoints `/extrair*` aceitam o campo opcional `medicamentos` (o fonte anterior do job o enviava com `Z_MEDIA` 1 ou 2):

```json
{
  "arquivo": "guia.pdf",
  "ambiente": "CYWSXT_PROD",
  "medicamentos": [{ "codigo": "90000001", "descricao": "INFLIXIMABE 100MG", "termos": ["INFLIXIMABE"] }],
  "mascarar": ["JOAO CARLOS DA SILVA", "00010002000123001"]
}
```

Com a lista e a extração OK, a resposta ganha o campo `ia`:

```json
{
  "ok": true, "texto": "...", "metodo": "pdf-parse",
  "ia": { "ok": true, "modelo": "claude-sonnet-5-5", "achados": [
    { "codigo": "90000001", "termo": "REMICADE", "contexto": "solicitado", "confianca": "media", "motivo": "prescrito na receita, nome comercial de infliximabe" }
  ] }
}
```

- Falha da IA nos `/extrair*` (timeout, chave inválida, `IA_HABILITADA=false`): `"ia": { "ok": false, "erro": "..." }`. O `ok` da extração continua `true` e o fonte anterior do job segue só com a busca exata.
- Antes do envio, o texto é cortado em `IA_MAX_CHARS` e mascarado ([`mascara.ts`](src/extracao/ia/mascara.ts)):
  - CPF, CNS, carteirinha, telefone, e-mail e data de nascimento;
  - os nomes e a matrícula do campo opcional `mascarar` (o job envia beneficiário, solicitante e matrícula da guia): cada parte do nome com 3+ letras, sem acento e tolerando I/l/1, O/0, S/5 do OCR;
  - o que vem depois de rótulos no início da linha ou coluna ("Paciente:", "Beneficiário:", "Nome da mãe:", "Médico solicitante:").

  Palavras dos medicamentos da lista nunca são mascaradas. Testes, sem chave nem API no ar: `npm run build && npm run test:mascara && npm run test:ia && npm run test:verificacao`. O `test:ia` usa um modelo falso e confere mascaramento no envio, validação dos achados (inclusive o descarte do que não é `solicitado`), corte em `IA_MAX_CHARS` e falha do provedor; o `test:verificacao` confere a classificação dos achados e a falha da IA virando erro.
- A lista de medicamentos vai no *system prompt* com `cache_control` (prompt caching). A saída é forçada numa ferramenta com esquema fixo (`codigo`, `termo`, `contexto`, `confianca`, `motivo`), e códigos fora da lista ou com contexto diferente de `solicitado` são descartados.
- A chamada ao Claude roda fora da fila de OCR (`EXTRACAO_CONCORRENCIA`).
- O log registra modelo, quantidade de achados e de não solicitados, tempo e tokens (sem texto do anexo).

## Código

Em `src/extracao/`:

| Peça | Papel |
|------|-------|
| `extracao.service.ts` | Orquestra a extração: valida o nome, baixa do SFTP, escolhe o extrator pela extensão e chama a IA (`/extrair*`) |
| `verificacao/` | `/verificar*`: extração, chamada à IA e classificação dos achados (`classificacao-ia.ts`); `GET /config` (`config.controller.ts`) |
| `extratores/` | Strategy por formato: `PdfExtrator` (pdf-parse, com OCR de fallback) e `ImagemExtrator`. Formato novo: classe que implementa `Extrator`, incluída em `EXTRATORES` no `extracao.module.ts` |
| `ocr/` | `MotorOcr` e a implementação `TesseractOcr`, usada pelos dois extratores |
| `ia/` | `IaService` (prompt, mascaramento, validação dos achados) e a porta `ModeloIa`, com o adapter `ClaudeAdapter`. Provedor novo: outro adapter, escolhido por `IA_PROVEDOR` em `modelo-ia.factory.ts` |
| `limitador-concorrencia.ts` / `pasta-temporaria.ts` | Fila do `EXTRACAO_CONCORRENCIA` e pasta exclusiva por requisição, apagada ao final |

## Testes (fase 4)

Em [`test/e2e/`](test/e2e/):

| Arquivo | Uso |
|---------|-----|
| `gerar-amostras.js` | Gera `texto.pdf`, `imagem.jpg`, `escaneado.pdf` e `comercial.pdf` (só nomes comerciais) em `test/e2e/amostras/` (precisa de `pdftoppm`) |
| `testar-api.js` | Envia as amostras, confere texto e `metodo`, testa 401/400/extensão inválida, o campo `ia`, o `/verificar` (lista obrigatória, campo `ia` recusado, descrição de 500 caracteres aceita; sem IA, "IA indisponivel") e o `GET /config` (401 sem token, `ia` booleano). Com `IA_TESTE=true`, exige que o Claude ache infliximabe e ustequinumabe na `comercial.pdf`, no `/extrair` e nos achados do `/verificar`, e `ia: true` no `/config` |
| `rodar-fase4.ps1` | Windows: sobe a API no Docker, gera as amostras e roda os testes, incluindo `test/testar-mascara.js`, `test/testar-ia.js` e `test/testar-verificacao.js` (`-Ia` liga o `IA_TESTE`) |
| `curl-exemplos.sh` | Linux: envia arquivos com curl |

Windows (na raiz `extracao-dados`):

```powershell
.\api-extracao-texto\test\e2e\rodar-fase4.ps1
```

Linux (API já rodando com `EXTRAIR_BASE64=true`, com poppler instalado):

```bash
read -rs API_TOKEN && export API_TOKEN   # mesmo valor do .env, sem ir para o histórico
npm run test:amostras
npm run test:e2e                         # API_URL opcional
bash test/e2e/curl-exemplos.sh           # ou: bash test/e2e/curl-exemplos.sh guia-real.pdf
```

Anexos reais colocados em `test/e2e/amostras/reais/` também são enviados pelo `testar-api.js` (só exibe o texto, sem asserção).

Para testar o download real do SFTP, informe um arquivo que exista em `SFTP_DIR`:

```powershell
docker exec -e SFTP_ARQUIVO="nome-do-arquivo.pdf" api-extracao-texto node test/e2e/testar-api.js
```

## Docker

```bash
cp .env.example .env    # obrigatório; defina API_TOKEN e SFTP_*
# produção em 10.1.5.14:6177 (infra/producao.env; sem test/ no container, /extrair desligado)
docker compose --env-file ../infra/producao.env -f ../infra/docker-compose.yml up -d --build
# dev/testes (monta test/ em /app/test e liga o /extrair)
docker compose -f ../infra/docker-compose.yml -f ../infra/docker-compose.dev.yml up -d --build
```

- Sobe em `http://${API_BIND_IP:-127.0.0.1}:${API_HOST_PORT:-3010}`. O Docker ignora o `ufw`: em produção, restrinja a porta na chain `DOCKER-USER` (`implantacao/README.md`, passo 1.5).
- `GET /health` (sem token) → `{ "ok": true }`, usado pelo `HEALTHCHECK` da imagem.
- O container roda como usuário `node`, e o token nunca fica gravado na imagem.

## pm2

```bash
# no servidor, após npm run build em /opt/api-extracao-texto
pm2 start ../infra/ecosystem.config.cjs --env production
```
