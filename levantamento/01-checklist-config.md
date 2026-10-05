# Checklist de configuração — Job OSMEDALTC

Preencher antes das etapas 2+ (API) e 5+ (TLPP). Valores entre `«...»` são placeholders.

## 1. FTP / SFTP (anexos / `ACB_OBJETO`)

**Ambiente:** DEV (`ftp_CYWSXT_dev`) — TOTVS Cloud  
**Protocolo informado:** `sftp://` (não é FTP clássico)

As credenciais ficam no `.env` da API (`api-extracao-texto/.env`), não no TLPP.

| Variável no `.env` | Valor | Observação |
|--------------------|-------|------------|
| Protocolo | **SFTP** | URL: `sftp://oestesaude175831.protheus.cloudtotvs.com.br:1151` |
| `SFTP_HOST` | `oestesaude175831.protheus.cloudtotvs.com.br` | Sem o prefixo `sftp://` |
| `SFTP_PORT` | `1151` | Porta SFTP Cloud TOTVS (não 21) |
| `SFTP_USER` | `ftp_CYWSXT_dev` | |
| `SFTP_PASSWORD` | `k0XRomYZtSbo6XaO1sda3A2P` | **Segredo** — não commitar em repo público |
| `SFTP_DIR` | `/dirdoc/co01/shared/` | Pasta dos anexos no SFTP Cloud |

### Estratégia SFTP
`FTPConnect` / `FTPDownload` do ADVPL falam **FTP**, não **SFTP**. Por isso o download é feito pela API: o job envia `{arquivo: ACB_OBJETO}` para `POST /extrair-sftp` e a API baixa, extrai e devolve o texto.

- [x] Conexão SFTP OK (a partir do container da API)
- [x] Pasta dos anexos anotada em `SFTP_DIR` (`/dirdoc/co01/shared/`)
- [x] Arquivo de amostra baixado (`parecer_tec_especializado_202609ad3998_2026_09_21_09_19.pdf` via `/extrair-sftp`)
- [x] Estratégia SFTP definida: download na API

## 2. E-mail

| #DEFINE / uso | Valor |
|---------------|-------|
| `__MAIL_TO` | `michel.ramos@oestesaude.com.br` |

Confirmar se o Protheus já envia e-mail (mesmo padrão de `OS_PJBENCAM` / `PLMailMessage`).

- [x] Destinatário definido
- [x] Infra de e-mail Protheus OK (já usada em outro job)

## 3. API de extração

| #DEFINE / uso | Valor | Observação |
|---------------|-------|------------|
| `__API_URL` | `fApiUrl()` no fonte | Ambiente `CYWSXT_PROD`: `http://10.1.5.14:6177/extrair-sftp`; qualquer outro: `http://localhost:3010/extrair-sftp` |
| Token `Authorization` | `API_TOKEN` em `api-extracao-texto/.env` | Header `Authorization: Bearer …`. **Secreto — não commitar**. No fonte vem da SX6 `Z_MEDAPIT` (mesmo valor) |

Infra (fase 2): scripts em [`infra/`](../infra/README.md) — `setup-linux.sh` / Docker.  
**Ambiente inicial:** API em **localhost** (`http://localhost:3010/extrair-sftp`).

- [x] Host inicial definido (`localhost:3010`)
- [ ] Host Linux provisionado (`sudo bash infra/setup-linux.sh` **ou** Docker) — quando for para servidor
- [ ] `verify-infra.sh` OK (Node ≥ 18, pdftoppm, tesseract `por`, pm2)
- [ ] Porta 6177 liberada AppServer de produção → `10.1.5.14`

## 4. Parâmetros de negócio

| Item | Valor | Padrão sugerido |
|------|-------|-----------------|
| `__CODDEP` | | `'012'` |
| `Z_NOTIENCA` (SX6) | | `'0'` ou recno de partida |
| `Z_MEDAPIT` (SX6, tipo C) | | mesmo valor de `API_TOKEN` no `.env` da API |
| Filial / empresa do job | | `{'01','01'}` no Scheduler |

- [ ] `Z_NOTIENCA` cadastrado (ver `04-sx6-z-notienca.md`)
- [ ] `Z_MEDAPIT` cadastrado (SIGACFG → Ambiente → Cadastros → Parâmetros)
- [ ] Departamento `012` confirmado como Auditoria / destino do job

## 5. Resultados das amostras SQL

### 5.1 B71 → origem → B53 → AC9 → ACB (`02-amostra-b71-acb.sql`)

| Pergunta | Resposta |
|----------|----------|
| Data usada em `B71_DATMOV` | «YYYYMMDD» |
| Linhas B71 `CODDEP=012` no dia | |
| Aliases `B71_ALIMOV` encontrados | «BEA, B4Q, …» |
| Algum registro chegou em `ACB_OBJETO` preenchido? | Sim / Não |
| Exemplo `B53_NUMGUI` + `ACB_OBJETO` | |
| Join guia→B53 precisou de `Left`/padding? | |

- [ ] SQL executada
- [ ] Resultado documentado (ou bloqueio: sem anexo no período)

### 5.2 BR8 + BA8 alto custo (`03-amostra-br8-ba8.sql`)

| Pergunta | Resposta |
|----------|----------|
| `BR8_ALTCUS = '1'` retorna linhas? | Sim / Não |
| Outro literal encontrado (`'S'`, etc.)? | |
| Join `BA8_CDPADP` + `BA8_CODPRO` OK? | Sim / Não |
| Qtd. medicamentos carregáveis | |
| Exemplo `BR8_CODPSA` + `BR8_DESCRI` | |

- [ ] SQL executada
- [ ] Literal `ALTCUS` e join confirmados

### 5.3 Critério por valor (`MEDICAMENTO_CRITERIO=valor`, `05-campos-valor.sql` consultas 5 e 6)

| Pergunta | Resposta |
|----------|----------|
| `MEDICAMENTO_VALOR_MIN` escolhido (R$) | |
| Qtd. medicamentos acima do valor (≤ 5000 com a IA ligada) | |
| Índice da BD4 começando por `FILIAL+CODTAB+CDPADP+CODPRO+CODIGO` existe? | Sim / Não |

- [ ] Só se for usar o critério por valor

## 6. Assinatura do levantamento

| Campo | Valor |
|-------|-------|
| Responsável | |
| Data | |
| Ambiente (homolog / prod) | |
| Etapa 1 concluída? | Sim / Não — motivo se Não |
