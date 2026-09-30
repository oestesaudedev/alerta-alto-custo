# Job de detecção de medicamentos de alto custo em anexos de guias (B71 → B53 / banco de conhecimento)

## Contexto
A auditoria precisa ser avisada por e-mail quando um anexo de guia (banco de conhecimento AC9/ACB vinculado à B53) pedir um medicamento de alto custo. O ADVPL/TLPP não lê PDF nem faz OCR sozinho. Por isso a solução tem duas partes:
1. **Job TLPP no Protheus** (AppServer Linux), rodando a cada 15 min pelo Scheduler. Ele parte da **B71** (movimentações do dia no departamento `012`, só os `R_E_C_N_O_` novos após `Z_NOTIENCA`), resolve a tabela origem, chega na B53/AC9/ACB, envia o nome do arquivo (`ACB_OBJETO`) para a API, compara o texto com medicamentos de alto custo (**BR8** + **BA8**, flag `BR8_ALTCUS`) e dispara o e-mail.
2. **API NestJS à parte**, que baixa o arquivo (PDF ou imagem) do SFTP e devolve o texto extraído. As credenciais do SFTP ficam no `.env` da API, porque o `FTPConnect` do ADVPL não fala SFTP.

Nada disso existe hoje na base: não há FTP, OCR, nem uso de AC9/ACB. Já existem padrões prontos de job, e-mail, HTTP e query, que serão reaproveitados.

## Controle de progresso — `Z_NOTIENCA` (SX6)
Parâmetro SX6 **`Z_NOTIENCA`** = último `R_E_C_N_O_` da **B71** já verificado (não confundir com `B71_RECMOV` da tabela origem).

1. No início do job: `nUltimo := Val(AllTrim(SuperGetMV("Z_NOTIENCA", .F., "0")))`.
2. A consulta só traz `B71.R_E_C_N_O_ > nUltimo` (+ `CODDEP`, data atual, não deletados), ordenado por `R_E_C_N_O_` crescente.
3. Após **cada** B71 verificado com sucesso (pipeline completo — com ou sem anexo/medicamento/e-mail), gravar `Z_NOTIENCA` com aquele `R_E_C_N_O_` (`PutMV` / padrão da base). Só avança.
4. Em falha (FTP/API): **não** avançar o watermark além do último sucesso — a próxima execução retoma dali.
5. Efeito: a próxima rodada do Scheduler **não reprocessa** nem reenvia e-mail dos já verificados.

Na etapa 1: cadastrar `Z_NOTIENCA` na SX6 se não existir (inicial `"0"` ou recno de partida).

## Medicamentos de alto custo — BR8 INNER JOIN BA8
Quem indica alto custo é a **BR8**, pelo campo **`BR8_ALTCUS`**. A **BA8** amarra o item na tabela dinâmica de eventos e fornece descrições auxiliares ao match.

`fCarregaMed()` (uma vez por execução):
- `FROM` BR8
- `INNER JOIN` BA8 em `BA8_CDPADP = BR8_CODPAD` **e** `BA8_CODPRO = BR8_CODPSA` **e** `BA8.D_E_L_E_T_ = ' '`
- `WHERE` `BR8_ALTCUS = '1'` **e** `BR8.D_E_L_E_T_ = ' '`
- Array (normalizado com `Upper(FwNoAccent(AllTrim()))`): `BR8_CODPSA`, `BR8_DESCRI` (match principal); `BA8_DESCRI`, `BA8_DPRINC` (se preenchidos)

Documentação do campo: `BR8_ALTCUS` = `'1'` Sim / `'0'` Não. Join padrão: `BA8_CDPADP` + `BA8_CODPRO`. Na etapa 1, confirmar na base com `levantamento/03-amostra-br8-ba8.sql`. Itens só na BR8 sem BA8 **não entram** (`INNER JOIN`).

## Fluxo da consulta

```
B71 (R_E_C_N_O_ > Z_NOTIENCA, DATMOV=hoje, CODDEP='012')
  → B71_ALIMOV + B71_RECMOV → tabela origem (BEA | B4Q | B44 | BE4 | B4A)
  → número da guia original/referência
  → B53 (B53_NUMGUI)
  → AC9 (AC9_CODENT LIKE '%' + B53_NUMGUI)
  → ACB (ACB_CODOBJ = AC9_CODOBJ)
  → ACB_OBJETO (arquivo no FTP)
```

### Entrada — B71
- `B71.R_E_C_N_O_ > Val(Z_NOTIENCA)` — **obrigatório; só os próximos**
- `B71_DATMOV` = data atual (`YYYYMMDD`)
- `B71_CODDEP` = `'012'`
- `B71.D_E_L_E_T_` = `' '`
- Campos usados: `R_E_C_N_O_`, `B71_ALIMOV`, `B71_RECMOV`, `B71_SEQUEN`, `B71_DATMOV`, `B71_OPERAD`, `B71_SEGMEN`, `B71_CODDEP`

### Tabela origem (`B71_ALIMOV` + `B71_RECMOV`)
`B71_RECMOV` aponta para o `R_E_C_N_O_` da tabela origem. Aliases previstos:

| Alias | Tabela | Campo da guia | Título |
|-------|--------|---------------|--------|
| BEA | Complementos Movimentações | `BEA_GUIORI` | Guia Original |
| BE4 | Internações | `BE4_GUIORI` | Guia Original |
| B44 | Cabeçalho Reembolso | `B44_GUIORI` | Guia Origem |
| B4Q | Cabeçalho Prorrogação Interna | `B4Q_GUIREF` | Nro. Gui. Ref. (não há `GUIORI`) |
| B4A | Cabeçalho Quimio/Radio/OPME | `B4A_GUIREF` | Nro. Gui. Ref. (não há `GUIORI`) |

Alias fora da lista: logar, pular o registro e **ainda assim avançar** `Z_NOTIENCA` (verificado/descartado), para não travar o cursor.

Join origem: `origem.R_E_C_N_O_ = Val(B71_RECMOV)` (tratar padding).  
Join guia → B53: `B53_NUMGUI` = guia com `AllTrim` (validar na base se precisa de `Left`/LIKE por diferença de tamanho).

### B53 → AC9 → ACB → FTP
- `INNER JOIN` AC9: `AC9_CODENT LIKE '%' + B53_NUMGUI` e `AC9.D_E_L_E_T_ = ' '`
- `INNER JOIN` ACB: `ACB_CODOBJ = AC9_CODOBJ` e `ACB.D_E_L_E_T_ = ' '`
- Filtrar `ACB_OBJETO <> ' '`
- **`ACB_OBJETO`** = nome do arquivo a baixar no FTP

`fConsulta()` (implementada na etapa 6) roda em duas partes, com `RetSqlName` / `ChangeQuery` / `MPSysOpenQuery`:
1. SQL só na B71 da janela (`R_E_C_N_O_ > Z_NOTIENCA`, `CODDEP`, `DATMOV` = hoje), ordenada por `R_E_C_N_O_`.
2. Para cada B71: `DbGoTo(Val(B71_RECMOV))` na tabela origem, lê o campo da guia e roda a SQL B53 → AC9 → ACB (`AC9_CODENT LIKE '%guia%'`, `ACB_OBJETO <> ' '`).

Não usa o `UNION ALL` com `INNER JOIN`: ele só traria B71 com anexo, e o watermark precisa avançar também sobre B71 sem anexo ou com alias desconhecido. Cada B71 volta com status: `OK`, `SEM_ANEXO`, `SEM_GUIA`, `ORIGEM_NAO_ENCONTRADA`, `ALIAS_DESCONHECIDO` ou `CAMPO_GUIA_INEXISTENTE`. A SQL de amostra `levantamento/02-amostra-b71-acb.sql` continua útil para validar os joins na base.

## Planejamento em etapas

| # | Etapa | Entrega | Status | Depende de |
|---|-------|---------|--------|------------|
| 1 | Levantamento | Pasta [`levantamento/`](levantamento/): checklist FTP/e-mail/API, SQLs de amostra, SX6 `Z_NOTIENCA` (`OS_CRIAZNOT.tlpp`) | Artefatos prontos — validar na base | — |
| 2 | Infra da API (Linux) | Pasta [`infra/`](infra/): `setup-linux.sh`, `verify-infra.sh`, Docker (Node 18+, poppler, tesseract-por, pm2) | Artefatos prontos — rodar no host | 1 |
| 3 | API de extração | Pasta [`api-extracao-texto/`](api-extracao-texto/) NestJS: `POST /extrair`, `POST /extrair-sftp`, token, README, Docker | Pronta — rodar em localhost:3010 | 2 |
| 4 | Teste da API | [`api-extracao-texto/test/e2e/`](api-extracao-texto/test/e2e/): PDF texto, PDF escaneado e JPG + 401/400 + SFTP | Concluída — 12/12 testes OK no Docker (inclui download real do SFTP) | 3 |
| 5 | Fonte TLPP: esqueleto | [`totvsCustomizacoes/Auditoria/OS_MEDALTC.tlpp`](totvsCustomizacoes/Auditoria/OS_MEDALTC.tlpp) com `#DEFINE`s, job, `dbgMEDALTC` e leitura de `Z_NOTIENCA` | Pronto — compilar e rodar `U_dbgMEDALTC` | 1 |
| 6 | Fonte TLPP: consulta + meds | `fConsulta()` (watermark B71) e `fCarregaMed()` (**BR8 INNER JOIN BA8**, `BR8_ALTCUS`) | Pronto — compilar e conferir o log de `U_dbgMEDALTC` | 5 |
| 7 | Download SFTP | Feito pela API: `POST /extrair-sftp` baixa `ACB_OBJETO` de `SFTP_DIR` com as credenciais do `.env` | Concluída (na API) — o TLPP não baixa arquivo | 3 |
| 8 | Fonte TLPP: integração | `fExtraiTexto(ACB_OBJETO)`: POST `{arquivo}` em `/extrair-sftp` via `FWRest` | Pronto — testar com a API alcançável pelo AppServer | 3, 5 |
| 9 | Fonte TLPP: regra + e-mail | `fBuscaMed()`, `fEnviaEmail()` e **gravação de `Z_NOTIENCA`** após cada B71 | Pronto — validar no teste integrado (etapa 10) | 6, 8 |
| 10 | Teste integrado | Pasta [`teste-integrado/`](teste-integrado/): roteiro, `U_chkMEDALTC` (diagnóstico sem gravar), `U_tstMEDALTC` (2 execuções + conferência do watermark), `conferencia.sql` | Artefatos prontos — executar no Protheus de teste | 4, 9 |
| 11 | Implantação | Pasta [`implantacao/`](implantacao/): roteiro (API em produção, RPO, SX6, Scheduler 15 min, monitoramento, rollback) e `monitoramento.sql`. URL da API por ambiente no fonte (`CYWSXT_PROD` → `10.1.5.14:6177`); pm2 sem `API_TOKEN` | Artefatos prontos — executar após a etapa 10 aprovada | 10 |

| 12 | Camada de procedimentos antes da IA | Procedimentos de alto custo da guia (BE2/BQV/B4C por `B53_TIPGUI`) e IA opcional via `IA_HABILITADA` (`GET /config`). Plano em [`planejamentos/camada-procedimentos-antes-da-ia.md`](planejamentos/camada-procedimentos-antes-da-ia.md) | Implementada — validar `B53_TIPGUI` com `levantamento/07-b53-tipgui-itens.sql` e repetir o teste integrado com IA ligada e desligada | 10 |

As etapas 2-4 e 7 (API) e 5-6 (TLPP) podem andar em paralelo. As duas frentes se juntam na etapa 8.

### Etapa 12 — camada de procedimentos antes da IA

Para cada B71, depois de resolver a guia, o job lê a B53 (`B53_TIPGUI`, `B53_ALIMOV`) e verifica os procedimentos lançados na guia antes de qualquer chamada à IA:

| `B53_TIPGUI` | Itens | Chave (= `B53_NUMGUI`) | Qtd / valor unitário |
|---|---|---|---|
| 1, 2, 3, 4, 5, 7 | BE2 | `OPEMOV + ANOAUT + MESAUT + NUMAUT` | `BE2_QTDSOL` / `BE2_VLRAPR` |
| 11 com `B53_ALIMOV = B4Q` | BQV | `CODOPE + ANOINT + MESINT + NUMINT` | `BQV_QTDSOL` / `BQV_VLRAPR` |
| demais | B4C | `OPEMOV + ANOAUT + MESAUT + NUMAUT` | `B4C_QTDSOL` / `B4C_VLRUNT` |

- Item de alto custo: `BR8_ALTCUS = '1'` no `CODPAD + CODPRO` (`fProcAltoCusto`).
- IA desligada (`GET /config` → `ia: false`): e-mail só com os procedimentos; anexos não são enviados.
- IA ligada: o `/verificar-sftp` roda nos anexos como antes e `fMescla` junta os resultados — procedimento confirmado ("Procedimento + IA"), não confirmado ("nao citado nos anexos" / "sem anexo para confirmar") e medicamento só no anexo ("Anexo (IA)").
- Substitui `fValorGuia` / `fCfgItens`, que usavam campos inexistentes na BQV (`BQV_OPEMOV`...) e na B4C (`B4C_VLRAPR`).
- `B53_TIPGUI` não é campo padrão; sem ele a B71 fica `CAMPO_B53_INEXISTENTE` e o watermark não avança.

## Parte 1: Fonte TLPP `totvsCustomizacoes/Auditoria/OS_MEDALTC.tlpp`

### Configuração (as "variáveis" pedidas)
Ficam como `#DEFINE` no topo, como em `OS_PJBENCAM.tlpp:5-6`. Opcionalmente podem virar parâmetros SX6 `Z_*` via `SuperGetMV`:
- SFTP (host, porta, usuário, senha e a variável **pasta**): **não ficam no TLPP**. Ficam no `.env` da API (`SFTP_HOST`, `SFTP_PORT`, `SFTP_USER`, `SFTP_PASSWORD`, `SFTP_DIR`)
- `__MAIL_TO`: a variável **email**
- `__API_URL`: URL da API de extração, escolhida por `fApiUrl()` pelo ambiente (`GetEnvServer()`): `CYWSXT_PROD` → `http://10.1.5.14:6177/extrair-sftp`; qualquer outro → `http://localhost:3010/extrair-sftp`. Mudar exige recompilar
- `__API_TOKEN`: token Bearer da API, lido da SX6 `Z_MEDAPIT` (não fica no fonte). Sem ele o job loga erro e não processa.
- `__CODDEP`: departamento na B71; padrão `'012'`
- `__CODOBJ`: filtro **opcional** de debug em `ACB_CODOBJ` (em branco = todos)
- Progresso: parâmetro SX6 **`Z_NOTIENCA`** (não `#DEFINE`) — último `R_E_C_N_O_` da B71 verificado

O filtro de medicamentos **não** usa mais `__TAB_MEDIC` / `BR8_CODPAD` como critério principal; o critério de negócio é **`BR8_ALTCUS`**.

### Estrutura
- `User Function OSMEDALTC(aJob)`: copia o padrão de `OS_PJBENCAM.tlpp:29-79`. Faz `RpcSetEnv` se `Select("SX2") <= 0`, depois `LockByName("OSMEDALTC",.T.,.F.)`, o processamento dentro de `BEGIN SEQUENCE/RECOVER`, e por fim `UnLockByName` e `RpcClearEnv`.
- `User Function dbgMEDALTC()`: chama `U_OSMEDALTC({'01','01'})`, para depuração. É a mesma convenção de `FSEmailBoleto.tlpp:70`.
- Leitura inicial de `Z_NOTIENCA` via `SuperGetMV`.
- `fCarregaMed()`: BR8 `INNER JOIN` BA8, `WHERE BR8_ALTCUS = '1'`. Devolve um item por `BR8_CODPSA` com os termos de busca (`BR8_DESCRI`, `BA8_DESCRI`, `BA8_DPRINC`) normalizados com `Upper(FwNoAccent(AllTrim()))`, sem repetição. Sem nenhum medicamento, o job encerra sem avançar o watermark.
- `fConsulta()`: ver "Fluxo da consulta". Devolve `{nRecno, cAliMov, cRecMov, cNumGui, aAnexos, cStatus}` por B71, com `aAnexos = {{ACB_CODOBJ, ACB_OBJETO}, ...}`. Todas as SQLs filtram `*_FILIAL = xFilial(...)`. O filtro de debug `__CODOBJ` é aplicado na SQL dos anexos.
- Laço sobre os registros (agrupados por B71 / `R_E_C_N_O_`):
  1. Para cada `ACB_OBJETO` preenchido: `fExtraiTexto(AllTrim(ACB_OBJETO))` — POST JSON `{arquivo}` em `__API_URL` (`/extrair-sftp`) via `FWRest`, header `Authorization: Bearer __API_TOKEN`, `SetTimeOut(120)`. Padrão de `FSWhatsapp.tlpp:300-427`. Texto via `JsonObject():FromJson()`. A API baixa o arquivo do SFTP; nada é gravado no AppServer.
  2. `fBuscaMed(aItem, aMed)`: normaliza texto e termos (sem acento, maiúsculas, pontuação e quebras de linha viram espaço) e procura cada termo BR8/BA8 como **palavra inteira**. Termos com menos de 4 caracteres são ignorados (falso positivo). No máximo uma ocorrência por medicamento em cada anexo.
  3. Se achar medicamento: `fEnviaEmail()` — **um e-mail por B71**, com todos os anexos e medicamentos dela. Envio por `TMailManager`/`TMailMessage` com o SMTP padrão do Protheus (`MV_RELSERV`, `MV_RELACNT`, `MV_RELPSW`, `MV_RELAUTH`, `MV_RELSSL`, `MV_RELTLS`, `MV_RELFROM`). Assunto: `[Alto custo] Guia <guia> - <n> medicamento(s) identificado(s)`. Corpo HTML: guia (`B53_NUMGUI`), origem (`B71_ALIMOV` + recno), recno da B71 e tabela com código, descrição BR8, **valor de tabela**, **valor na guia**, termo encontrado e anexo. **Não** inclui trecho do texto do anexo (dados de saúde).
     - Alto custo: só `BR8_ALTCUS = '1'`. O valor não entra na decisão.
     - Valor de tabela (`fCarregaVlrTab`): BR8 → BA8 → **BD4** (`BA8_CODTAB + BA8_CDPADP + BA8_CODPRO = BD4_CODTAB + BD4_CDPADP + BD4_CODPRO`, confirmado no dicionário), campo `BD4_VALREF`. Sempre a **vigência mais recente**: para cada tabela + unidade (`BD4_CODIGO`), o maior `BD4_VIGINI <= hoje`; `BD4_VIGFIM` não é considerado e vigências futuras ficam de fora. Mais de uma tabela/unidade: listadas com " / ". Sem valor: `sem valor na tabela`.
     - Valor na guia: desde a etapa 12, vem dos procedimentos da guia (`fProcAltoCusto`, tabela de itens por `B53_TIPGUI`): quantidade solicitada × valor unitário. Medicamento só no anexo: `nao consta`.
     - Tabela ou campo ausente no dicionário, ou erro na query: a coluna sai `n/d` e o job segue (não bloqueia o watermark). Confirmar os nomes com [`levantamento/05-campos-valor.sql`](levantamento/05-campos-valor.sql).
  4. Após a B71 verificada com sucesso: gravar `Z_NOTIENCA` com aquele `R_E_C_N_O_` (`PutMV`). Falha no SMTP conta como falha temporária: não avança e a B71 é retomada (o e-mail é tentado de novo).
  - `CAMPO_GUIA_INEXISTENTE` (erro de dicionário) também não avança: o job para nessa B71 até o mapeamento ser corrigido.
  - `{ok:false}` com "arquivo não encontrado no SFTP", "extensão não suportada" ou "nome de arquivo inválido" é resultado definitivo: o anexo é descartado e a B71 segue. Qualquer outra falha (API fora, timeout, token, conexão SFTP, erro de extração) é temporária: o laço para nessa B71 e ela e as seguintes ficam para a próxima execução.
  - Implementado na etapa 8: `fProcessaB71()` chama `fExtraiTexto()` para cada anexo e guarda `{ACB_OBJETO, texto, metodo}` no item da B71. O texto vem em UTF-8 e é convertido com `DecodeUTF8`. O log registra só tamanho, método e tempo, nunca o conteúdo (dados de saúde).
- Logs com `FwLogMsg`/`ConOut` em cada etapa.

### Agendamento
Scheduler Protheus (CFGX032): cadastrar `U_OSMEDALTC` com parâmetro `{'01','01'}` e recorrência de 15 minutos. O cabeçalho Protheus.doc documenta isso, como em `OS_PJBENCAM.tlpp:13-22`.

## Parte 2: API NestJS `api-extracao-texto/` (fora do Protheus)
- **Stack:** **NestJS** (Node 18+), `pdf-parse` (PDF com texto), `pdftoppm` (poppler-utils) para PDFs escaneados e `tesseract-ocr` com idioma `por` para imagens.
  - Os pacotes Linux são `apt install poppler-utils tesseract-ocr tesseract-ocr-por`, com chamadas via `child_process` no service Nest.
- **Estrutura mínima NestJS:** módulo de extração (`ExtracaoModule`), `ExtracaoController` (`POST /extrair`), `ExtracaoService` (PDF/OCR), guard/middleware de token no header `Authorization`, limpeza de arquivos temporários após o uso. Rodar como serviço (pm2 ou systemd) na rede interna.
- **`POST /extrair`** recebe `{nome, conteudoBase64}`:
  - Se a extensão é `.pdf`, roda o `pdf-parse`. Se o texto vier vazio ou muito curto, é escaneado: converte as páginas em PNG com `pdftoppm` e passa pelo OCR.
  - Se a extensão é `.jpg/.jpeg/.png/.tif/.bmp`, roda `tesseract <arq> stdout -l por`.
  - Resposta HTTP 200: `{ ok:true, texto:"...", metodo:"pdf-parse|ocr-pdf|ocr-imagem" }` ou `{ ok:false, erro:"..." }`. Token inválido → 401 e campo faltando → 400, ambos com `{ ok:false, erro }`.
  - Limite do corpo JSON: `BODY_LIMIT` (padrão `25mb`).
- **`POST /extrair-sftp`** recebe `{arquivo}` (o `ACB_OBJETO`, sem caminho): baixa `SFTP_DIR/arquivo` do SFTP e aplica a mesma extração. Mesma resposta do `/extrair`. Arquivo inexistente → `{ ok:false, erro:"arquivo não encontrado no SFTP: ..." }`. Nomes com `/` ou `\` são recusados.
- **SFTP no `.env`:** `SFTP_HOST`, `SFTP_PORT`, `SFTP_USER`, `SFTP_PASSWORD`, `SFTP_DIR` (lib `ssh2-sftp-client`).
- Arquivos: projeto NestJS (`package.json`, `src/main.ts`, módulos/controllers/services, `README.md` de instalação).

## Pontos de atenção
- **`Z_NOTIENCA`** evita reprocessamento e reenvio de e-mail; é o `R_E_C_N_O_` da **B71**, não o `B71_RECMOV` da origem.
- Em falha de SFTP/API no meio do registro, o watermark **não** avança — a próxima execução retoma.
- A máquina da API precisa alcançar o SFTP (`SFTP_HOST:SFTP_PORT`) e o AppServer precisa alcançar a API.
- `AC9_CODENT LIKE '%' + B53_NUMGUI` impede o uso de índice. O volume fica limitado por `CODDEP='012'` + watermark + data do dia.
- B4Q/B4A usam `GUIREF` (não existe `GUIORI`). Se a base real usar outro campo (`GUIOPE`/`GUIPRE`), ajustar só o mapeamento após a amostra da etapa 1.
- Alias `B71_ALIMOV` inesperado: log + avançar watermark, sem abortar o job.
- O job só verifica B71 do dia corrente. B71 que ficam pendentes na virada do dia (job parado ou falhando) não são processadas depois; o job registra `WARN` com a quantidade (`fAvisaAtrasadas`) para conferência manual.
- Match por descrição depende do OCR e de `BR8_DESCRI` / `BA8_DESCRI` / `BA8_DPRINC`.
- Itens só na BR8 sem correspondente na BA8 **não entram** (`INNER JOIN`).

## Verificação
1. API NestJS: `api-extracao-texto/test/e2e/rodar-fase4.ps1` (Windows/Docker) ou `npm run test:amostras && npm run test:e2e` / `curl-exemplos.sh` (Linux). Confere o texto e o `metodo` de um PDF de texto, um PDF escaneado e um JPG, e o `/extrair-sftp` (401/400, nome com caminho, arquivo inexistente e, com `SFTP_ARQUIVO=<nome>`, um download real).
2. Base: validar amostra B71 (`CODDEP='012'`, `DATMOV` conhecido, `R_E_C_N_O_ > Z_NOTIENCA`) → origem → `B53_NUMGUI` → AC9/ACB com `ACB_OBJETO` preenchido. Validar `BR8_ALTCUS` + join BA8.
3. Protheus: compilar `OS_MEDALTC.tlpp` e `teste-integrado/OS_TSTMEDALTC.tlpp` no RPO de teste. `U_chkMEDALTC()` confere token, watermark, medicamentos, B71 da janela, API + SFTP e SMTP sem gravar nada; `U_chkMEDALTC("<ACB_OBJETO>")` mostra quais medicamentos um anexo real dispara.
4. Posicionar `Z_NOTIENCA` antes de uma B71 com anexo que cite medicamento com `BR8_ALTCUS` (B71 antiga: `__DATA_DBG`) e confirmar o e-mail em `__MAIL_TO`.
5. `U_tstMEDALTC()` roda o job duas vezes: a 2ª parte do `Z_NOTIENCA` gravado pela 1ª e não reprocessa nem reenvia e-mail. O watermark é lido com `GetMV` (sem o cache do `SuperGetMV`), para valer também com duas execuções na mesma thread. Roteiro completo e cenários de falha em [`teste-integrado/README.md`](teste-integrado/README.md).
6. Scheduler 15 min + lock impedindo execução concorrente.
