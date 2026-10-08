# Configurações do job OSMEDALTC e da API de extração

Este guia lista tudo o que precisa ser configurado para a solução funcionar, e onde cada item fica. São três lugares:

1. `.env` **da API** (`api-extracao-texto/.env`): token da API, credenciais do SFTP, se a IA está ligada (`IA_HABILITADA`) e, com ela ligada, a chave da Anthropic, e o critério dos medicamentos (`MEDICAMENTO_CRITERIO` / `MEDICAMENTO_VALOR_MIN`).
2. **Protheus**: parâmetros SX6, constantes do fonte `OS_MEDALTC.tlpp` e o Scheduler.
3. **Rede**: portas que precisam estar liberadas entre as máquinas.

> **Segredos** (token da API, senha do SFTP e `ANTHROPIC_API_KEY`) ficam só no `.env` da API e na SX6. Não coloque em fonte, README ou repositório. O `.env` já está no `.gitignore`.

---

## 1. API de extração — `api-extracao-texto/.env`

Crie o arquivo a partir do modelo:

```powershell
Copy-Item api-extracao-texto\.env.example api-extracao-texto\.env
```


| Variável             | Obrigatória        | Exemplo / padrão                              | Para que serve                                                                                                                    |
| -------------------- | ------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `API_TOKEN`          | **Sim**            | valor aleatório, 32+ caracteres               | Token que o job envia no header `Authorization: Bearer ...`. Tem que ser **igual** ao parâmetro `Z_MEDAPIT` do Protheus. A API não sobe com ele vazio, curto ou `dev-change-me` |
| `SFTP_AMBIENTE_PROD` | Não                | `CYWSXT_PROD`                                 | Ambiente do Protheus (campo `ambiente` que o job envia com `GetEnvServer()`) que usa o SFTP de produção; os demais usam o de dev  |
| `SFTP_PROD_HOST`     | Na API de produção | `oestesaude169995.protheus.cloudtotvs.com.br` | Servidor SFTP de produção (sem `sftp://`)                                                                                         |
| `SFTP_PROD_PORT`     | Na API de produção | `2323`                                        | Porta do SFTP de produção                                                                                                         |
| `SFTP_PROD_USER`     | Na API de produção | `ftp_CYWSXT_prod`                             | Usuário do SFTP de produção                                                                                                       |
| `SFTP_PROD_PASSWORD` | Na API de produção | —                                             | Senha do SFTP de produção                                                                                                         |
| `SFTP_PROD_HOSTKEY`  | Na API de produção | `SHA256:ocHwC1nv...` (no `.env.example`)      | Impressão digital do servidor SFTP de produção. A API recusa a conexão se a chave apresentada for outra (proteção contra servidor falso) |
| `SFTP_DEV_HOST`      | Na API de dev      | `oestesaude175831.protheus.cloudtotvs.com.br` | Servidor SFTP de dev (sem `sftp://`)                                                                                              |
| `SFTP_DEV_PORT`      | Na API de dev      | `1151`                                        | Porta do SFTP de dev                                                                                                              |
| `SFTP_DEV_USER`      | Na API de dev      | `ftp_CYWSXT_dev`                              | Usuário do SFTP de dev                                                                                                            |
| `SFTP_DEV_PASSWORD`  | Na API de dev      | —                                             | Senha do SFTP de dev. Deixe `SFTP_DEV_*` vazio no servidor de produção                                                            |
| `SFTP_DEV_HOSTKEY`   | Na API de dev      | três `SHA256:...` (no `.env.example`)         | Impressões digitais do servidor SFTP de dev, separadas por vírgula                                                               |
| `SFTP_DIR`           | **Sim**            | `/dirdoc/co01/shared/`                        | Pasta onde estão os arquivos do `ACB_OBJETO`                                                                                      |
| `PORT`               | Não                | `3010`                                        | Porta HTTP da API                                                                                                                 |
| `OCR_TMP_DIR`        | Não                | `./ocr-tmp`                                   | Pasta temporária dos arquivos durante a extração (apagados ao final)                                                              |
| `PDF_MIN_TEXT_CHARS` | Não                | `40`                                          | Abaixo dessa quantidade de caracteres, o PDF é tratado como escaneado e vai para OCR                                              |
| `PDF_MAX_PAGINAS`    | Não                | `30`                                          | Máximo de páginas de PDF escaneado passadas pelo OCR (o resto é ignorado, com aviso no log), para caber no `__API_TIMEOUT` do job |
| `EXTRACAO_CONCORRENCIA` | Não             | `2`                                           | Extrações simultâneas (OCR usa muita CPU e memória). As demais esperam numa fila de até 20; acima disso a API responde "API ocupada" e o job tenta de novo na próxima execução |
| `EXTRAIR_BASE64`     | Não                | `false`                                       | Habilita o `POST /extrair` (arquivo em Base64), usado só pelos testes (junto com o `POST /verificar`). O job usa o `/verificar-sftp`. Deixe `false` em produção     |
| `BODY_LIMIT`         | Não                | `25mb`                                        | Tamanho máximo do JSON recebido quando `EXTRAIR_BASE64=true`. Com ele desligado, vale o `BODY_LIMIT_LISTA` |
| `BODY_LIMIT_LISTA`   | Não                | `20mb`                                        | Tamanho máximo do JSON com `EXTRAIR_BASE64=false`. O maior pedido é a lista completa de medicamentos no `POST /medicamentos` (~4,6 MB para 30 mil itens) |
| `IA_HABILITADA`      | Não                | `false` / `true`                              | Liga o Claude nos anexos (seção 1.1). O job lê o valor pelo `GET /config` a cada execução. `false` (padrão): o alerta sai só pelos procedimentos de alto custo lançados na guia e os anexos não são enviados. `true`: o Claude também confirma os procedimentos nos anexos e acrescenta medicamentos citados que não foram lançados |
| `IA_PROVEDOR`        | Não                | `anthropic`                                   | Provedor da IA. Hoje só `anthropic`; outro valor impede a subida com `IA_HABILITADA=true`                                          |
| `ANTHROPIC_API_KEY`  | Com a IA ligada    | `sk-ant-...`                                  | Chave da API da Anthropic. A API não sobe com `IA_HABILITADA=true` e a chave vazia                                                 |
| `IA_MODELO`          | Não                | `claude-sonnet-5-5`                           | Modelo do Claude. `claude-haiku-4-5` é mais barato e mais rápido, com menos precisão em nomes comerciais e erros de OCR           |
| `IA_TIMEOUT_MS`      | Não                | `60000`                                       | Tempo máximo da chamada ao Claude (com 1 nova tentativa em 429/5xx dentro desse tempo). Somado ao OCR, precisa caber no `__API_TIMEOUT` (300 s) do job |
| `IA_MAX_CHARS`       | Não                | `100000`                                      | Máximo de caracteres do texto do anexo enviados ao Claude. O resto não é lido: a API registra `WARN` e devolve o aviso `texto-cortado`, que o job registra no log |
| `MEDICAMENTO_CRITERIO` | Não              | `altcus` / `valor`                            | Quais itens da BR8 (`BR8_CODPAD` em `__CODPAD_BR8`) entram na lista de medicamentos, lida pelo job no `GET /config` a cada execução. `altcus` (padrão): `BR8_ALTCUS = '1'`. `valor`: valor de tabela BD4 vigente maior que `MEDICAMENTO_VALOR_MIN` em alguma tabela/unidade (seção 2.5). Outro valor impede a subida |
| `MEDICAMENTO_VALOR_MIN` | Com `valor`     | `1500.00`                                     | Valor mínimo em reais (ponto decimal), exclusivo: entra o item com `BD4_VALREF` **maior** que ele. A API não sobe com `MEDICAMENTO_CRITERIO=valor` e este vazio ou ≤ 0. Não há teto prático para a lista (até 100000 itens): a IA recebe só os candidatos da pré-busca de cada anexo |
| `PRE_BUSCA_MAX_CANDIDATOS` | Não          | `300`                                         | Máximo de medicamentos achados pela pré-busca no texto do anexo e enviados ao Claude. Acima disso vão os de maior pontuação e o job registra `WARN [pre-busca]` |
| `PRE_BUSCA_DF_MAX`   | Não                | `500`                                         | Palavra presente em mais itens da lista que isto não traz candidato sozinha (só soma pontos). Evita que nomes genéricos repetidos em centenas de itens mandem todos à IA |

As impressões digitais do SFTP (`SFTP_*_HOSTKEY`) são obrigatórias para o perfil cujo `HOST` estiver preenchido. Para conferir ou atualizar (se a TOTVS trocar a chave do servidor, a API passa a responder "chave do servidor SFTP ... não confere" e o job para até o `.env` ser corrigido):

```bash
ssh-keyscan -p 2323 oestesaude169995.protheus.cloudtotvs.com.br | ssh-keygen -lf -
```


Para gerar um token novo (PowerShell):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Depois de alterar o `.env`, reinicie a API para ela ler os valores novos.

### 1.1 IA (Claude): confirmação nos anexos (opcional)

A primeira verificação é sempre a dos procedimentos lançados na guia (seção 2.5), feita pelo job no Protheus. Com a IA ligada, a API manda também o texto extraído de cada anexo e a lista de medicamentos de alto custo (código, descrição e termos da BR8/BA8, enviada pelo job) ao Claude, que devolve os medicamentos da lista citados: pelo nome do cadastro, nome comercial (ex.: Remicade → infliximabe), princípio ativo, abreviação ou com erro de OCR. O job junta os dois resultados: procedimento citado no anexo fica "Procedimento + IA"; procedimento não citado continua no alerta, marcado "nao citado nos anexos" ou "sem anexo para confirmar"; medicamento citado no anexo e não lançado entra como "Anexo (IA)".

- **Configuração só na API**: `IA_HABILITADA` (+ `ANTHROPIC_API_KEY` quando `true`) no `.env`. Não há parâmetro no Protheus: o job pergunta à API pelo `GET /config` no início de cada execução. Se a API não responder, a execução termina sem avançar o `Z_NOTIENCA`. Depois de mudar o valor, reinicie a API.
- **IA desligada**: os anexos não são baixados nem enviados; o e-mail sai só com os procedimentos e sem as colunas da IA.
- **Confiança**: achados com confiança alta ou média entram no alerta; os de confiança baixa só vão para o log (`[IA] ... com confianca baixa: fora do alerta`).
- **Falha da IA com ela ligada**: timeout, chave inválida ou API da Anthropic fora fazem a API responder "IA indisponivel: ...". O job trata como falha temporária: não avança o `Z_NOTIENCA` e retoma a B71 na próxima execução.
- **Dados de saúde**: antes do envio, a API troca por marcadores (`[NOME]`, `[CPF]`, `[CARTEIRINHA]`...):
  - CPF, CNS, carteirinha, telefone, e-mail e data de nascimento (padrões fixos);
  - o nome do beneficiário, o nome do solicitante e a matrícula da guia, que o job envia no campo `mascarar` (campos em `__CPO_NOMES` / `__CPO_MATRIC`, seção 2.2; sem nome na tabela da guia, o job busca o `BA1_NOMUSR` pela matrícula). Cada parte do nome com 3 letras ou mais é mascarada em qualquer lugar do texto, sem acento e tolerando trocas comuns do OCR (I/l/1, O/0, S/5), inclusive em formas abreviadas como "J. C. SILVA";
  - o que vem depois de rótulos no início da linha ou coluna, como "Paciente:", "Beneficiário:", "Nome da mãe:" e "Médico solicitante:".

  Palavras dos medicamentos da lista nunca são mascaradas. Continuam passando nomes soltos no texto corrido que não sejam do beneficiário nem do solicitante (parentes, outros médicos). O Claude devolve só código, termo encontrado, confiança e um motivo curto; o e-mail e o log continuam sem trechos do anexo nem os nomes.
- **Custo**: uma chamada por anexo, para todo anexo verificado. Para reduzir o custo, `IA_MODELO=claude-haiku-4-5` (mais barato e mais rápido; validar a precisão com anexos reais antes). A lista de medicamentos vai com *prompt caching*, então ela é cobrada com desconto nas chamadas seguintes (cache de 5 minutos). A API registra no log os tokens de cada chamada (`IA claude-...: n achado(s) ... (entrada, cache, saída)`).
- **Antes de ligar em produção**: validar com jurídico/DPO o envio de dados de saúde à Anthropic e formalizar os termos comerciais, o DPA e a retenção zero de dados (ZDR). A máquina da API precisa de saída HTTPS (443) para `api.anthropic.com` (seção 3).

### Rodando no Docker (`infra/docker-compose.yml`)

- O compose lê o `.env` da API (`env_file`), então token e SFTP valem também para o container.
- `PORT`, `OCR_TMP_DIR`, `PDF_MIN_TEXT_CHARS`, `PDF_MAX_PAGINAS`, `BODY_LIMIT` e `EXTRAIR_BASE64` estão fixos no compose e **têm precedência** sobre o `.env`.
- Porta exposta no computador: `API_HOST_PORT` (padrão `3010`), só na interface `API_BIND_IP` (padrão `127.0.0.1`). Em produção use `API_BIND_IP=10.1.5.14` e `API_HOST_PORT=6177`, a porta que o Protheus `CYWSXT_PROD` chama.
- O Docker não respeita as regras do `ufw`. Em produção, restrinja a porta ao AppServer na chain `DOCKER-USER` (`implantacao/README.md`, passo 1.5).
- O `.env` é obrigatório: sem ele o compose não sobe.
- `infra/docker-compose.dev.yml` (override de dev) monta `api-extracao-texto/test` no container e habilita o `POST /extrair` para os testes da fase 4.

```powershell
# produção
$env:API_BIND_IP = '10.1.5.14'; $env:API_HOST_PORT = 6177; docker compose -f infra/docker-compose.yml up -d --build
# dev/testes
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d --build
```



### Rodando com pm2 (`infra/ecosystem.config.cjs`)

- A API lê o `.env` da pasta `cwd` (`/opt/api-extracao-texto/.env`).
- Porta: `3010` no `env` de desenvolvimento e `6177` no `env_production` (`--env production`).
- O `ecosystem.config.cjs` **não** define `API_TOKEN`: variável de ambiente do pm2 venceria o `.env`. Não acrescente o token nele.

---



## 2. Protheus



### 2.1 Parâmetros SX6

Cadastro em **SIGACFG → Ambiente → Cadastros → Parâmetros**, com filial em branco (vale para todas).


| Parâmetro    | Tipo | Valor                                         | Para que serve                                                                                                                                                                      |
| ------------ | ---- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Z_NOTIENCA` | C    | `0` na primeira vez, ou o recno de partida    | Último `R_E_C_N_O_` da **B71** já verificado. O job só processa as B71 acima desse valor e o avança sozinho. Pode ser criado com `U_OSCRIAZNOT()` (`levantamento/OS_CRIAZNOT.tlpp`) |
| `Z_MEDAPIT`  | C    | o mesmo valor de `API_TOKEN` do `.env` da API | Token Bearer enviado para a API. Vazio: o job registra erro e não processa                                                                                                          |
| Observações: |      |                                               |                                                                                                                                                                                     |


- **Não altere** `Z_NOTIENCA` **à mão** com o job rodando. Diminuir o valor faz o job reprocessar B71 e reenviar e-mails; aumentar faz pular registros.
- Se trocar o `API_TOKEN` da API, troque o `Z_MEDAPIT` junto. Com valores diferentes a API responde 401 e o job não avança.



### 2.2 Constantes no fonte `totvsCustomizacoes/Auditoria/OS_MEDALTC.tlpp`

Ficam como `#DEFINE` no topo do fonte. Alterar exige recompilar.


| Constante       | Valor atual                      | Para que serve                                                                                                                                                                                                                                               |
| --------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `__MAIL_TO`     | `{"michel.ramos@oestesaude.com.br"}` | Destinatários do e-mail de alerta, um elemento do array por e-mail (ex.: `{"a@oestesaude.com.br", "b@oestesaude.com.br"}`). Lista vazia bloqueia o job                                                                                                                                                                                                                           |
| `__API_URL`     | `fApiUrl()`                      | Endereço da API, escolhido pelo ambiente do Protheus (`GetEnvServer()`): `CYWSXT_PROD` (`__ENV_PROD`) usa `http://10.1.5.14:6177` (`__URL_PROD`); qualquer outro usa `__URL_DEV`. O caminho é `__API_PATH` (`/verificar-sftp`). Mudar exige recompilar |
| `__CODDEP`      | `{"012"}`                        | Departamentos filtrados na B71 (`B71_CODDEP IN (...)`). Array vazio (`{}`) = todos os departamentos                                                                                                                                                          |
| `__CODOBJ`      | `""` (vazio)                     | Filtro de depuração: preenchido, processa só esse `ACB_CODOBJ`. Em produção, deixe vazio                                                                                                                                                                     |
| `__LOG_DIR` / `__LOG_ARQ` | `"\logpls\"` / `"alto_custo"` | Log em arquivo, um por dia: `\logpls\alto_custo_AAAAMMDD.log` no RootPath, com as mesmas linhas do console. Gravado pela função padrão do PLS `PlsPtuLog`; se ela não existir no RPO, o fonte grava por conta própria em `__LOG_DIR`. A pasta é criada sozinha; os arquivos antigos são apagados manualmente |
| `__DATA_DBG`    | `""` (vazio)                     | Depuração: preenchido com `AAAAMMDD`, a B71 é filtrada por essa data em vez de hoje (teste com B71 antiga). Em produção, deixe vazio                                                                                                                         |
| `__CPO_NOMES` / `__CPO_MATRIC` | `{"_NOMUSR", "_NOMSOL"}` / `{"_OPEUSR", "_CODEMP", "_MATRIC", "_TIPREG", "_DIGITO"}` | Sufixos dos campos da tabela de origem da guia (prefixo = alias, ex.: `BEA_NOMUSR`) com os nomes e a matrícula que a API mascara antes de enviar o texto ao Claude. Campo que não existir no dicionário é ignorado. O nome do beneficiário (`_NOMUSR` ou `BA1_NOMUSR` pela matrícula) também vai no e-mail |
| `__CPO_DATENT` | `{"_DTDIGI", "_DATDIG", "_DATSOL"}` | Sufixos tentados na tabela de origem da guia, na ordem, para a "Data da solicitação" do e-mail (data em que a guia entrou no sistema). Vale o primeiro que existir e estiver preenchido; nenhum: `n/d`. Conferir com `levantamento/08-campos-data-entrada.sql` |
| `__API_TIMEOUT` | `300`                            | Tempo máximo (segundos) de espera pela API por anexo. Timeout conta como falha temporária (a B71 é retomada), por isso a API limita o OCR a `PDF_MAX_PAGINAS`                                                                                                |
| `__CFG_PATH`    | `/config`                        | Caminho do `GET` que informa se a IA está ligada na API (mesma URL base do `__API_URL`)                                                                                                                                                                     |
| `__LST_PATH`    | `/medicamentos`                  | Caminho do `POST` com a lista completa de medicamentos, enviado no primeiro anexo de cada execução (mesma URL base). Devolve o `listaId` usado no `__API_PATH` |
| `__TIP_BE2` / `__TIP_BQV` | `{1, 2, 3, 4, 5, 7}` / `11` | `B53_TIPO` cujos itens ficam na BE2; `11` com `B71_ALIMOV = B4Q` usa a BQV; os demais, a B4C (seção 2.5)                                                                                                                                           |
| `__NUMGUI_PT`   | `{4, 4, 2, 8}`                   | Partes do `B53_NUMGUI` (OPEMOV + ANOAUT + MESAUT + NUMAUT) usadas como chave dos itens da guia                                                                                                                                                              |
| `__CODPAD_BR8`  | `{"00", "20", "18"}`             | Tabelas padrão (`BR8_CODPAD`) consideradas no alto custo: lista de medicamentos (BR8/BA8/BD4) e procedimentos da guia. Item com `BR8_ALTCUS = '1'` em outro CODPAD vai só para o log, como ignorado                                                        |
| `__TAB_ALIAS` / `__TAB_CPOS` | `"BF8"` / `{"BF8_CODINT", "BF8_CODIGO", "BF8_DESCM", "BF8_CODPAD"}` | Cadastro das tabelas de preço (`BD4_CODTAB` = CODINT + CODIGO), de onde vêm a descrição e o Tp.Pad.Saude de cada linha do "Valor de tabela" no e-mail. Ordem dos campos: CODINT, CODIGO, descrição, CODPAD. Sem a tabela ou um campo no dicionário, o job registra `WARN` e o e-mail sai só com o código. Conferir com `levantamento/05-campos-valor.sql` (consulta 7) |




### 2.3 Scheduler

Cadastro em **Configurador → Scheduler (CFGX032)**:


| Campo       | Valor                           |
| ----------- | ------------------------------- |
| Rotina      | `U_OSMEDALTC`                   |
| Parâmetros  | `{'01','01'}` (empresa, filial) |
| Recorrência | a cada 15 minutos               |


Execuções simultâneas são bloqueadas pelo próprio job (`LockByName`). Para testar manualmente, execute `U_dbgMEDALTC`. Para verificar as B71 de outra data no fluxo normal, `U_dataMEDALTC("AAAAMMDD")` (ou `"DD/MM/AAAA"`): só entram as B71 dessa data acima do `Z_NOTIENCA`.

### 2.4 E-mail (SMTP)

O job envia pela conta `sistema@oestesaude.com.br`, com a configuração fixa nas constantes `__SMTP_*` do fonte. Os parâmetros `MV_REL*` do Protheus não são usados.


| Constante      | Valor                       | Para que serve                         |
| -------------- | --------------------------- | -------------------------------------- |
| `__SMTP_HOST`  | `sender.skymail.net.br`     | Servidor SMTP                          |
| `__SMTP_PORTA` | `587`                       | Porta                                  |
| `__SMTP_USER`  | `sistema@oestesaude.com.br` | Conta usada para autenticar            |
| `__SMTP_SENHA` | (no fonte)                  | Senha da conta                         |
| `__SMTP_FROM`  | `__SMTP_USER`               | Remetente                              |
| `__SMTP_AUTH`  | `.T.`                       | Se o servidor exige autenticação       |
| `__SMTP_SSL`   | `.F.`                       | Conexão SSL                            |
| `__SMTP_TLS`   | `.T.`                       | Conexão TLS (porta 587)                |


O destinatário é a constante `__MAIL_TO` do fonte (seção 2.2). É enviado **um e-mail por movimentação B71** em que algum item de alto custo foi encontrado. A coluna "Detecção" diz de onde veio o item (Procedimento, Procedimento + IA ou Anexo (IA)); "Qtd" e "Valor na guia" vêm dos itens da guia. "Valor de tabela" é uma mini-tabela com uma linha por tabela de preço e unidade vigentes (Valor = `BD4_VALREF`, Tabela = `BD4_CODTAB`, Descrição e Tp.Pad do cadastro `__TAB_ALIAS`, Unid. = `BD4_CODIGO`, Vigência = "Vigente (sem fim)" ou "Vigente até ..." pelo `BD4_VIGFIM`; linhas com `BD4_VIGFIM` antes de hoje não aparecem. A escolha da linha continua pelo maior `BD4_VIGINI` ≤ hoje, e o critério VALOR não olha o `BD4_VIGFIM`); sem preço em tabela vigente sai `sem valor em tabela vigente`, e sem os campos da BD4 sai `n/d`. Com a IA ligada, a coluna "Observação IA" traz a confirmação, a confiança e o motivo dados pelo Claude (ex.: "confirmado pela IA: IA (media): nome comercial de infliximabe"). Se o envio falhar, o job não avança o `Z_NOTIENCA` e tenta de novo na próxima execução.

O corpo é enviado como `text/html` e só em ASCII: acentos fixos usam entidades HTML e os textos vindos do banco (nome do beneficiário, descrição da BR8...) têm os caracteres acentuados convertidos em entidades numéricas (`&#227;`), então aparecem certos em qualquer cliente de e-mail, independentemente do charset.

**Teste de envio:** `U_chkMEDALTC` só conecta e autentica. Para confirmar que a mensagem chega, rode `U_mailMEDALTC()` (envia para `__MAIL_TO`) ou `U_mailMEDALTC("a@oestesaude.com.br;b@oestesaude.com.br")`. Ele não consulta B71 nem grava o `Z_NOTIENCA`; confira a caixa de entrada, o spam e se os acentos da linha de teste saíram corretos.

### 2.5 Procedimentos da guia (camada antes da IA)

Para cada B71, o job resolve a guia, localiza a **B53** pelo `B53_NUMGUI` (a mais recente, se houver mais de uma) e escolhe a tabela de itens pelo tipo da guia:

| `B53_TIPO` | Itens (cabeçalho) | Chave dos itens = `B53_NUMGUI` | Quantidade / valor unitário |
| --- | --- | --- | --- |
| `1`, `2`, `3`, `4`, `5`, `7` | `BE2` (`BEA`) | `BE2_OPEMOV + BE2_ANOAUT + BE2_MESAUT + BE2_NUMAUT` | `BE2_QTDSOL` / `BE2_VLRAPR` |
| `11` com `B71_ALIMOV = B4Q` | `BQV` (`B4Q`) | `BQV_CODOPE + BQV_ANOINT + BQV_MESINT + BQV_NUMINT` | `BQV_QTDSOL` / `BQV_VLRAPR` |
| demais | `B4C` (`B4A`) | `B4C_OPEMOV + B4C_ANOAUT + B4C_MESAUT + B4C_NUMAUT` | `B4C_QTDSOL` / `B4C_VLRUNT` |

- **B71 da BEA** (`B71_ALIMOV = BEA`): o job lê a chave `BEA_OPEMOV + BEA_ANOAUT + BEA_MESAUT + BEA_NUMAUT` no registro apontado pelo `B71_RECMOV`. Nos itens da BE2, essa chave substitui o `B53_NUMGUI`; e, se o `BEA_GUIORI` estiver vazio, ela também é usada como número da guia para achar a B53 e os anexos (antes a B71 era concluída sem verificação). O log indica `chave da BEA recno ...` ou `pela chave da BEA`.
- Um item é de alto custo quando o `CODPAD + CODPRO` dele está na lista de medicamentos carregada no início da execução (`fCarregaMed`), com o `CODPAD` em `__CODPAD_BR8`. A lista segue o `MEDICAMENTO_CRITERIO` do `.env` da API:
  - `altcus` (padrão): `BR8_ALTCUS = '1'`. Com `BR8_ALTCUS = '1'` em outro CODPAD, o log mostra `alto custo na BR8, CODPAD fora de ... (ignorado)` e o item não entra no e-mail.
  - `valor`: alguma tabela/unidade da BD4 (via `BA8_CODTAB`) na vigência mais recente até hoje tem `BD4_VALREF > MEDICAMENTO_VALOR_MIN`. Item sem BA8 ou sem BD4 vigente fica de fora. O log marca `ALTO CUSTO (valor de tabela BD4 > R$ ...)`.
  - A lista é montada uma vez por execução e consultada por um índice em memória; a consulta dos itens da guia não muda nem acrescenta JOIN com a BD4. Para calibrar o valor, use a contagem em `levantamento/05-campos-valor.sql`.
- Valor na guia = soma de quantidade solicitada × valor unitário dos itens com o mesmo código (quantidade zerada conta como 1).
- O alias vem da própria B71 (`B71_ALIMOV`, a tabela origem da movimentação), não da B53. Sem o `B53_TIPO` no dicionário, o job registra `CAMPO_B53_INEXISTENTE` e não avança o `Z_NOTIENCA`. Confira com `levantamento/07-b53-tipgui-itens.sql`.
- Guia sem B53: nada a verificar, a B71 é concluída. Tabela ou campo de itens ausente no dicionário: `ERROR` no log e a B71 segue sem procedimentos. Erro na consulta dos itens: falha temporária (não avança).

---



## 3. Rede


| Origem                                | Destino                            | Porta                 | Para quê                         |
| ------------------------------------- | ---------------------------------- | --------------------- | -------------------------------- |
| AppServer de produção (`CYWSXT_PROD`) | `10.1.5.14`                        | `6177` (TCP)          | O job chama `GET /config`, `POST /medicamentos` e `POST /verificar-sftp` |
| AppServer dos demais ambientes        | a própria máquina (`localhost`)    | `3010` (TCP)          | O job chama `GET /config`, `POST /medicamentos` e `POST /verificar-sftp` |
| Máquina da API                        | `SFTP_PROD_HOST` / `SFTP_DEV_HOST` | `2323` / `1151` (TCP) | A API baixa os anexos (só com a IA ligada) |
| Máquina da API                        | `api.anthropic.com`                | `443` (HTTPS)         | A API chama o Claude (só com a IA ligada) |


- Fora do `CYWSXT_PROD` o job usa `localhost:3010`, então a API precisa estar na **mesma máquina** do AppServer desse ambiente.
- Em produção a API roda em `10.1.5.14` na porta `6177` (pm2 com `--env production`, ou Docker com `API_HOST_PORT=6177`).
- Não exponha a porta da API na internet. Em produção, libere a `6177` só para o IP do AppServer (pm2: `ufw`, aplicado pelo `setup-linux.sh` com `APPSERVER_IP`; Docker: chain `DOCKER-USER`).

---



## 4. Checklist rápido

- [ ] `api-extracao-texto/.env` criado com `API_TOKEN` (32+ caracteres), `SFTP_DIR`, as `SFTP_PROD_*` (produção) ou `SFTP_DEV_*` (dev), incluindo o `*_HOSTKEY`, e `IA_HABILITADA` decidido (`true` exige `ANTHROPIC_API_KEY`)
- [ ] Com a IA ligada: saída 443 da máquina da API para `api.anthropic.com`
- [ ] `B53_TIPO` e os campos dos itens (BE2, BQV, B4C) conferidos com `levantamento/07-b53-tipgui-itens.sql`
- [ ] API no ar (Docker ou pm2) e respondendo em `http://localhost:3010` (dev) ou `http://10.1.5.14:6177` (produção)
- [ ] Teste da API: `.\api-extracao-texto\test\e2e\rodar-fase4.ps1` (todos os testes OK)
- [ ] SX6 `Z_NOTIENCA` cadastrado
- [ ] SX6 `Z_MEDAPIT` cadastrado com o mesmo valor do `API_TOKEN`
- [ ] `U_chkMEDALTC` com `[OK] Flag da IA` mostrando o estado esperado; com a IA ligada, `U_chkMEDALTC("arquivo.pdf")` com `[OK] Verificacao de arquivo.pdf (extracao + IA)`
- [ ] `U_chkMEDALTC` com `[OK] SMTP (sender.skymail.net.br)` (seção 2.4)
- [ ] `U_mailMEDALTC()` com `Teste de e-mail OK` e a mensagem recebida (fora do spam, acentos corretos)
- [ ] Valor de tabela conferido com `levantamento/05-campos-valor.sql` (BD4); campo ausente só deixa a coluna como `n/d`
- [ ] AppServer alcançando a API: `localhost:3010` fora da produção, `10.1.5.14:6177` no `CYWSXT_PROD` (a linha `Config: ambiente ... | API ...` do log mostra a URL escolhida)
- [ ] `OS_MEDALTC.tlpp` compilado no RPO
- [ ] `U_chkMEDALTC` com todas as verificações `[OK]` (roteiro em `teste-integrado/README.md`)
- [ ] `U_tstMEDALTC` terminando com `Teste integrado OK` e um único e-mail por B71
- [ ] `__DATA_DBG` e `__CODOBJ` vazios antes de compilar para produção
- [ ] Scheduler cadastrado (`U_OSMEDALTC`, `{'01','01'}`, 15 min) — roteiro de produção em `implantacao/README.md`