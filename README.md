# Alerta de medicamentos de alto custo (OSMEDALTC)

Avisa a auditoria por e-mail quando um anexo de guia (PDF ou imagem, no banco de conhecimento do Protheus) cita um medicamento de alto custo.

O ADVPL/TLPP não lê PDF nem faz OCR, e o `FTPConnect` não fala SFTP. Por isso a solução tem duas partes:

| Parte | Onde roda | O que faz |
|---|---|---|
| **Job TLPP `U_OSMEDALTC`** ([OS_MEDALTC.tlpp](totvsCustomizacoes/Auditoria/OS_MEDALTC.tlpp)) | AppServer Protheus, pelo Scheduler a cada 15 min | Busca as movimentações novas, encontra os anexos, pede o texto à API, compara com os medicamentos de alto custo e envia o e-mail |
| **API NestJS** ([api-extracao-texto/](api-extracao-texto/)) | Servidor Linux ou Docker na rede interna | Baixa o arquivo do SFTP e devolve o texto (`pdf-parse` para PDF com texto, `pdftoppm` + Tesseract `por` para PDF escaneado e imagens) |

## Como funciona

```
Scheduler (15 min) → U_OSMEDALTC
  1. Lê Z_NOTIENCA (último R_E_C_N_O_ da B71 já verificado)
  2. Carrega os medicamentos: BR8 (BR8_ALTCUS = '1') INNER JOIN BA8 + valor de tabela (BD4)
  3. B71 novas: R_E_C_N_O_ > Z_NOTIENCA, B71_DATMOV = hoje, B71_CODDEP = '012'
  4. Para cada B71:
       B71_ALIMOV + B71_RECMOV → tabela origem (BEA | BE4 | B44 | B4Q | B4A) → número da guia
       → B53 (B53_NUMGUI) → AC9 (AC9_CODENT contém a guia) → ACB (ACB_OBJETO = nome do arquivo)
       → POST /extrair-sftp {arquivo, ambiente} na API → API baixa do SFTP e devolve o texto
       → procura as descrições BR8/BA8 no texto (palavra inteira, sem acento, ≥ 4 letras)
       → achou? um e-mail por B71 para __MAIL_TO
       → grava Z_NOTIENCA = recno da B71
```

Regras importantes:

- **Sem reprocessamento.** O `Z_NOTIENCA` avança após cada B71 concluída, com ou sem anexo, medicamento ou e-mail. A próxima execução não repete e-mail.
- **Falha temporária não avança.** API fora, timeout (300 s por anexo), token errado, SFTP inacessível, SMTP fora ou chamada sem o campo `ambiente` (fonte antigo no RPO, HTTP 400): o job para na B71 e a retoma na próxima execução.
- **Falha definitiva é descartada.** Arquivo inexistente no SFTP, extensão não suportada ou nome inválido: o anexo é ignorado e a B71 segue.
- **Só o dia corrente.** O agendamento não processa B71 de dias anteriores que ficaram pendentes (job parado na virada do dia); o log registra um `WARN` com a quantidade. Para verificá-las, use `U_dataMEDALTC` (ver [Manutenção](#manutenção-do-dia-a-dia)).
- **PDF escaneado longo.** A API passa pelo OCR só as primeiras `PDF_MAX_PAGINAS` páginas (padrão 30), para responder dentro do timeout. Medicamento citado só depois disso não é detectado; o log da API avisa.
- **Execução única.** `LockByName` impede duas execuções simultâneas.
- **Dados de saúde.** O e-mail e o log não trazem trechos do texto do anexo, só tamanho, método e tempo.

O e-mail traz guia, origem, recno da B71 e, por medicamento: código, descrição BR8, valor de tabela (BD4, vigência mais recente), valor na guia (soma dos itens da guia de origem), termo encontrado e anexo. Valor indisponível no dicionário aparece como `n/d` e não bloqueia o job.

## Configuração inicial

A referência completa, com todos os parâmetros, está em [configuracoes.md](configuracoes.md). O mínimo para subir:

### 1. API de extração

1. Criar o `.env` a partir do modelo:
   ```powershell
   Copy-Item api-extracao-texto\.env.example api-extracao-texto\.env
   ```
2. Preencher:

   | Variável | Valor |
   |---|---|
   | `API_TOKEN` | Token longo e aleatório: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `SFTP_AMBIENTE_PROD` | `CYWSXT_PROD`: ambiente do Protheus (campo `ambiente` que o job envia) que usa o SFTP de produção; os demais usam o de dev |
   | `SFTP_PROD_*` (`HOST`, `PORT`, `USER`, `PASSWORD`) | SFTP de produção, usado quando o job roda no `CYWSXT_PROD` (porta `2323`) |
   | `SFTP_DEV_*` (`HOST`, `PORT`, `USER`, `PASSWORD`) | SFTP de dev, usado nos demais ambientes (porta `1151`). **Vazio no servidor de produção** |
   | `SFTP_DIR` | Pasta dos arquivos do `ACB_OBJETO` (`/dirdoc/co01/shared/`) |
   | `PDF_MAX_PAGINAS` | Opcional, padrão `30`: páginas de PDF escaneado passadas pelo OCR |

3. Subir a API:
   - **Docker**: produção com `API_HOST_PORT=6177 docker compose -f infra/docker-compose.yml up -d --build`; dev/testes acrescentando `-f infra/docker-compose.dev.yml` (monta `test/`) → `http://localhost:3010`. Gera a imagem `alerta-alto-custo` e sobe o container `api-extracao-texto`; `docker ps` deve mostrar `healthy` (`GET /health`).
   - **Linux + pm2** (produção): `sudo bash infra/setup-linux.sh`, `bash infra/verify-infra.sh`, build em `/opt/api-extracao-texto` e `pm2 start infra/ecosystem.config.cjs --env production` (porta `6177`). Não coloque `API_TOKEN` no `ecosystem.config.cjs`: a variável do pm2 venceria o `.env`.
4. Testar: `.\api-extracao-texto\test\e2e\rodar-fase4.ps1` (Windows/Docker) ou `npm run test:amostras && npm run test:e2e` (Linux).

### 2. Protheus

1. **Parâmetros SX6** (SIGACFG → Ambiente → Cadastros → Parâmetros, filial em branco, tipo C):

   | Parâmetro | Valor |
   |---|---|
   | `Z_NOTIENCA` | `0`, ou o maior recno atual da B71 para começar "a partir de agora" (consulta 1 de [monitoramento.sql](implantacao/monitoramento.sql)). Pode ser criado com `U_OSCRIAZNOT` ([OS_CRIAZNOT.tlpp](levantamento/OS_CRIAZNOT.tlpp)) |
   | `Z_MEDAPIT` | O mesmo valor de `API_TOKEN` do `.env` da API |

2. **SMTP**: conferir `MV_RELSERV`, `MV_RELACNT`, `MV_RELPSW`, `MV_RELAUTH`, `MV_RELSSL`, `MV_RELTLS` e `MV_RELFROM`. São os mesmos dos outros envios de e-mail do Protheus.
3. **Constantes do fonte** (`#DEFINE` no topo de [OS_MEDALTC.tlpp](totvsCustomizacoes/Auditoria/OS_MEDALTC.tlpp); alterar exige recompilar):

   | Constante | Conferir |
   |---|---|
   | `__MAIL_TO` | Caixa que recebe os alertas (hoje aponta para um e-mail pessoal) |
   | `__ENV_PROD` / `__URL_PROD` | Ambiente `CYWSXT_PROD` usa `http://10.1.5.14:6177`; qualquer outro usa `__URL_DEV` (`http://localhost:3010`) |
   | `__CODDEP` | Departamento da B71 (`012`) |
   | `__DATA_DBG` / `__CODOBJ` | Filtros de depuração. **Vazios em produção** |

4. **Compilar** `OS_MEDALTC.tlpp` no RPO.
5. **Diagnóstico**: rodar `U_chkMEDALTC()`. Ele confere token, watermark, medicamentos, B71 da janela, API + SFTP e SMTP sem gravar nada nem enviar e-mail. Todas as linhas devem sair `[OK]`.
6. **Scheduler** (CFGX032): rotina `U_OSMEDALTC`, parâmetros `{'01','01'}`, a cada 15 minutos.

### 3. Rede

| Origem | Destino | Porta |
|---|---|---|
| AppServer de produção (`CYWSXT_PROD`) | `10.1.5.14` (API) | `6177` |
| AppServer dos demais ambientes | `localhost` (API na mesma máquina) | `3010` |
| Máquina da API | `SFTP_PROD_HOST` / `SFTP_DEV_HOST` | `2323` / `1151` |

Não exponha a porta da API na internet.

## Funções do Protheus

| Função | Uso |
|---|---|
| `U_OSMEDALTC(aJob)` | O job (Scheduler) |
| `U_dbgMEDALTC()` | Executa o job manualmente em `01/01` |
| `U_dataMEDALTC("AAAAMMDD")` | Executa o job para as B71 de outra data (aceita também `DD/MM/AAAA`), no fluxo normal: watermark, extração, e-mail |
| `U_chkMEDALTC([cArquivo])` | Diagnóstico sem gravar. Com um `ACB_OBJETO` real, mostra quais medicamentos o anexo dispararia |
| `U_tstMEDALTC()` | Teste integrado: roda o job duas vezes e confere que não há reprocessamento. **Só no RPO de teste** |
| `U_OSCRIAZNOT([cValor])` | Cria ou ajusta o `Z_NOTIENCA` |

## Manutenção do dia a dia

| Mudança | Como |
|---|---|
| Incluir ou tirar medicamento | Campo `BR8_ALTCUS` na BR8 (precisa ter BA8 correspondente). Vale na próxima execução |
| Trocar o token | `API_TOKEN` no `.env` + reiniciar a API (pm2: `pm2 restart api-extracao-texto`; Docker: `docker compose -f infra/docker-compose.yml up -d`, pois `docker restart` não relê o `.env`), e `Z_MEDAPIT` no mesmo momento |
| Mudar destinatário ou URL da API | `__MAIL_TO` / `__URL_PROD` no fonte + recompilar |
| Reprocessar uma B71 do dia | Pausar o agendamento e gravar `Z_NOTIENCA` = recno − 1. Reenvia o e-mail dela e das seguintes |
| Verificar B71 de outra data | Pausar o agendamento, gravar `Z_NOTIENCA` = primeiro recno da data − 1 e rodar `U_dataMEDALTC("AAAAMMDD")`. As B71 de hoje acima desse valor são verificadas pela próxima rodada normal (reenvia e-mail das que já tinham sido) |

Não altere o `Z_NOTIENCA` com o job rodando: diminuir reenvia e-mails, aumentar pula registros.

## Estrutura do repositório

| Pasta / arquivo | Conteúdo |
|---|---|
| [totvsCustomizacoes/Auditoria/](totvsCustomizacoes/Auditoria/) | Fonte do job (`OS_MEDALTC.tlpp`), o único que vai para produção |
| [api-extracao-texto/](api-extracao-texto/) | API NestJS (`POST /extrair`, `POST /extrair-sftp`, `GET /health`), `Dockerfile` e testes e2e |
| [infra/](infra/) | `docker-compose.yml` (produção) e `docker-compose.dev.yml` (dev), provisionamento Linux e pm2 |
| [levantamento/](levantamento/) | Checklist e SQLs para validar tabelas, joins e campos na base |
| [teste-integrado/](teste-integrado/) | Roteiro de teste, `OS_TSTMEDALTC.tlpp` e `conferencia.sql` |
| [implantacao/](implantacao/) | Roteiro de produção, monitoramento, rollback e `monitoramento.sql` |
| [configuracoes.md](configuracoes.md) | Referência de todos os parâmetros |
| [preciso-fazer-o-seguinte-indexed-pie.md](preciso-fazer-o-seguinte-indexed-pie.md) | Especificação técnica e planejamento em etapas |

Para ir a produção, siga [implantacao/README.md](implantacao/README.md), depois de aprovar o [teste integrado](teste-integrado/README.md).
