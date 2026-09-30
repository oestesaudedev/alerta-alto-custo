# Etapa 1 — Levantamento

Artefatos para coletar configuração e validar na base Protheus antes das etapas de código (API / TLPP).

| Arquivo | Uso |
|---------|-----|
| [01-checklist-config.md](01-checklist-config.md) | Preencher FTP/SFTP, e-mail, host da API e anotar resultados das amostras |
| [02-amostra-b71-acb.sql](02-amostra-b71-acb.sql) | Rodar no banco — fluxo B71 → origem → B53 → AC9 → ACB |
| [03-amostra-br8-ba8.sql](03-amostra-br8-ba8.sql) | Rodar no banco — medicamentos `BR8_ALTCUS` + join BA8 |
| [04-sx6-z-notienca.md](04-sx6-z-notienca.md) | Cadastro do parâmetro SX6 `Z_NOTIENCA` |
| [05-campos-valor.sql](05-campos-valor.sql) | Rodar no banco — campos das colunas de valor do e-mail |
| [06-campos-nomes.sql](06-campos-nomes.sql) | Rodar no banco — campos de nome e matrícula mascarados antes do Claude |
| [OS_CRIAZNOT.tlpp](OS_CRIAZNOT.tlpp) | Fonte opcional para criar/atualizar `Z_NOTIENCA` via SmartClient |

## Premissas já fechadas pelos schemas

| Item | Valor |
|------|-------|
| `BR8_ALTCUS` | `1` = Sim, `0` = Não |
| Join BA8 | `BA8_CDPADP = BR8_CODPAD` e `BA8_CODPRO = BR8_CODPSA` |
| `B53_NUMGUI` | Char 18 |

## Já preenchido no checklist

| Item | Status |
|------|--------|
| SFTP DEV | Host `oestesaude175831.protheus.cloudtotvs.com.br`, porta `1151`, user `ftp_CYWSXT_dev` |
| Pasta SFTP | `/dirdoc/co01/shared/` |
| E-mail | `michel.ramos@oestesaude.com.br` (infra Protheus OK) |
| API / SQLs / `Z_NOTIENCA` | `__API_URL` = `http://localhost:3010/extrair-sftp`; token em `api-extracao-texto/.env` (`API_TOKEN`); API NestJS pronta; SQLs e SX6 pendentes |
| Infra API (fase 2) | Artefatos em [`infra/`](../infra/README.md) — executar no host Linux ou Docker |

**Impacto:** o endpoint é **SFTP**, não FTP. `FTPConnect` ADVPL pode não servir — definir estratégia antes da etapa 7.

## Como marcar a etapa 1 como concluída

- Checklist com FTP/SFTP (incl. pasta), e-mail e API.
- `Z_NOTIENCA` cadastrado na SX6.
- Amostras SQL documentadas (ou bloqueio conhecido).
