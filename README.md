# Alerta de itens de alto custo (OSMEDALTC)

Avisa a auditoria por e-mail quando uma guia tem procedimento de alto custo lançado e, com a IA ligada, quando um anexo da guia (PDF ou imagem, no banco de conhecimento do Protheus) cita um medicamento de alto custo.

O ADVPL/TLPP não lê PDF nem faz OCR, e o `FTPConnect` não fala SFTP. Por isso a solução tem duas partes:

| Parte | Onde roda | O que faz |
|---|---|---|
| **Job TLPP `U_OSMEDALTC`** ([OS_MEDALTC.tlpp](totvsCustomizacoes/Auditoria/OS_MEDALTC.tlpp)) | AppServer Protheus, pelo Scheduler a cada 15 min | Busca as movimentações novas, verifica os procedimentos de alto custo lançados na guia e, com a IA ligada, manda à API o nome de cada anexo e a lista de medicamentos de alto custo; junta os resultados e envia o e-mail |
| **API NestJS** ([api-extracao-texto/](api-extracao-texto/)) | Servidor Linux ou Docker na rede interna | Informa se a IA está ligada (`GET /config`). Com ela ligada, recebe a lista de medicamentos uma vez por execução (`POST /medicamentos`), baixa o arquivo do SFTP, extrai o texto (`pdf-parse` para PDF com texto, `pdftoppm` + Tesseract `por` para PDF escaneado e imagens), faz uma pré-busca das palavras da lista no texto e pede ao Claude (Anthropic) quais desses candidatos o texto cita |

## Como funciona

```
Scheduler (15 min) → U_OSMEDALTC
  1. Lê Z_NOTIENCA (último R_E_C_N_O_ da B71 já verificado)
  2. GET /config na API: IA ligada ou não (IA_HABILITADA) e critério dos medicamentos (MEDICAMENTO_CRITERIO) no .env da API
  3. Carrega os medicamentos: BR8 (BR8_CODPAD em __CODPAD_BR8 e, pelo critério, BR8_ALTCUS = '1' ou
     valor de tabela BD4 vigente > MEDICAMENTO_VALOR_MIN) LEFT JOIN BA8 + valor de tabela (BD4)
  4. B71 novas: R_E_C_N_O_ > Z_NOTIENCA, B71_DATMOV = hoje, B71_CODDEP = '012'
  5. Para cada B71:
       B71_ALIMOV + B71_RECMOV → tabela origem (BEA | BE4 | B44 | B4Q | B4A) → número da guia
         (BEA: chave OPEMOV+ANOAUT+MESAUT+NUMAUT do próprio registro nos itens da BE2 e, sem BEA_GUIORI, como guia)
       → B53 (B53_NUMGUI): B53_TIPO e B71_ALIMOV escolhem a tabela de itens
           1, 2, 3, 4, 5, 7 → BE2 | 11 com B71_ALIMOV = B4Q → BQV | demais → B4C
       → procedimentos da guia (chave = B53_NUMGUI) com BR8_ALTCUS = '1' e CODPAD 00 ou 20, com qtd e valor na guia
       → só com a IA ligada:
           AC9 (AC9_CODENT contém a guia) → ACB (ACB_OBJETO = nome do arquivo)
           → no primeiro anexo da execução: POST /medicamentos {medicamentos} (lista completa, sem teto) → listaId
           → POST /verificar-sftp {arquivo, ambiente, listaId, mascarar} na API, que:
               baixa do SFTP e extrai o texto
               pré-busca: acha no texto as palavras da lista (tolerando erros de OCR) → candidatos
               sem candidato, não chama o Claude; com candidatos, mascara os dados pessoais e pergunta
               ao Claude quais deles o texto cita
               (API reiniciada: "lista de medicamentos desconhecida" → o job reenvia a lista e repete)
               devolve os achados de confiança alta ou média (sem o texto); os de confiança baixa, como aviso
           → junta: procedimento confirmado pela IA / não citado / medicamento só no anexo
       → algum item? um e-mail por B71 para __MAIL_TO
       → grava Z_NOTIENCA = recno da B71
```

Regras importantes:

- **Sem reprocessamento.** O `Z_NOTIENCA` avança após cada B71 concluída, com ou sem anexo, medicamento ou e-mail. A próxima execução não repete e-mail.
- **Falha temporária não avança.** API fora (inclusive no `GET /config` do início da execução), timeout (300 s por anexo), token errado, SFTP inacessível, IA ligada mas indisponível (Claude fora, chave inválida), erro na consulta dos itens da guia, SMTP fora, requisição recusada pela API (HTTP 400) ou API antiga, sem o `/config`, o `/medicamentos` ou o `/verificar-sftp` (HTTP 404): o job para na B71 e a retoma na próxima execução. `B53_TIPO` ausente no dicionário também bloqueia (`CAMPO_B53_INEXISTENTE`).
- **Falha definitiva é descartada.** Arquivo inexistente no SFTP, extensão não suportada ou nome inválido: o anexo é ignorado e a B71 segue.
- **Só o dia corrente.** O agendamento não processa B71 de dias anteriores que ficaram pendentes (job parado na virada do dia); o log registra um `WARN` com a quantidade. Para verificá-las, use `U_dataMEDALTC` (ver [Manutenção](#manutenção-do-dia-a-dia)).
- **PDF escaneado longo.** A API passa pelo OCR só as primeiras `PDF_MAX_PAGINAS` páginas (padrão 30), para responder dentro do timeout. Medicamento citado só depois disso não é detectado; o log da API avisa.
- **Execução única.** `LockByName` impede duas execuções simultâneas.
- **Dados de saúde.** O e-mail e o log não trazem trechos do texto do anexo, só tamanho, método e tempo. O nome do beneficiário vai no e-mail, mas não no log.
- **Procedimentos primeiro.** Todo procedimento lançado na guia com `BR8_ALTCUS = '1'` e `CODPAD` `00` ou `20` entra no alerta, com ou sem IA. Guia sem anexo também é verificada. Detalhes em [configuracoes.md](configuracoes.md#25-procedimentos-da-guia-camada-antes-da-ia).
- **A IA (Claude) é opcional.** Com `IA_HABILITADA=true`, o Claude lê o texto de cada anexo e aponta os medicamentos da lista citados pelo nome do cadastro, nome comercial, princípio ativo, abreviação ou com erro de OCR. Ela confirma os procedimentos ("Procedimento + IA") e acrescenta os medicamentos citados que não foram lançados ("Anexo (IA)"); procedimento não citado continua no alerta. Confiança alta ou média entra no alerta; baixa só no log. Com `IA_HABILITADA=false`, os anexos não são enviados e o alerta sai só pelos procedimentos. Antes do envio, a API mascara CPF, CNS, carteirinha, telefone, e-mail, data de nascimento, os nomes do beneficiário e do solicitante da guia (enviados pelo job) e o que vier depois de rótulos como "Paciente:". O texto do anexo não volta para o Protheus. Detalhes em [configuracoes.md](configuracoes.md#11-ia-claude-confirmação-nos-anexos-opcional).
- **Log.** Tudo o que o job registra vai para `\logpls\alto_custo_AAAAMMDD.log` no RootPath (um arquivo por dia, criado sozinho, gravado pela função padrão do PLS `PlsPtuLog`, com gravação própria como fallback) e para o console do AppServer. Os arquivos antigos são apagados manualmente.

O e-mail traz o nome do beneficiário (`<alias>_NOMUSR` da origem ou `BA1_NOMUSR` pela matrícula), o número da guia, o tipo da guia por extenso (combo do `B53_TIPO` no dicionário), a data da solicitação (data em que a guia entrou no sistema, `__CPO_DATENT`), a origem, o recno da B71 e, por item: código, descrição BR8, detecção (Procedimento, Procedimento + IA ou Anexo (IA)), quantidade e valor na guia (quantidade solicitada × valor unitário dos itens), valor de tabela (BD4, vigência mais recente; uma linha por tabela de preço, com código, descrição e Tp.Pad.Saude da BF8 e a unidade) e, com a IA ligada, termo encontrado, anexo e a observação da IA (confirmação, confiança e motivo). Valor indisponível no dicionário aparece como `n/d` e não bloqueia o job.

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
   | `API_TOKEN` | Token aleatório com 32 ou mais caracteres: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. A API não sobe com token vazio, curto ou `dev-change-me` |
   | `SFTP_AMBIENTE_PROD` | `CYWSXT_PROD`: ambiente do Protheus (campo `ambiente` que o job envia) que usa o SFTP de produção; os demais usam o de dev |
   | `SFTP_PROD_*` (`HOST`, `PORT`, `USER`, `PASSWORD`) | SFTP de produção, usado quando o job roda no `CYWSXT_PROD` (porta `2323`) |
   | `SFTP_DEV_*` (`HOST`, `PORT`, `USER`, `PASSWORD`) | SFTP de dev, usado nos demais ambientes (porta `1151`). **Vazio no servidor de produção** |
   | `SFTP_PROD_HOSTKEY` / `SFTP_DEV_HOSTKEY` | Impressões digitais do servidor SFTP (`SHA256:...`, separadas por vírgula), já preenchidas no `.env.example`. Obrigatórias quando o `HOST` do perfil está preenchido; a API recusa servidor com chave diferente. Para conferir: `ssh-keyscan -p PORTA HOST \| ssh-keygen -lf -` |
   | `SFTP_DIR` | Pasta dos arquivos do `ACB_OBJETO` (`/dirdoc/co01/shared/`) |
   | `PDF_MAX_PAGINAS` | Opcional, padrão `30`: páginas de PDF escaneado passadas pelo OCR |
   | `IA_HABILITADA` / `ANTHROPIC_API_KEY` | `false`: alerta só pelos procedimentos da guia. `true` + a chave da Anthropic: o Claude também verifica os anexos (exige saída HTTPS para `api.anthropic.com`). Modelo em `IA_MODELO` (padrão `claude-sonnet-5-5`; `claude-haiku-4-5` custa menos). Mudar exige reiniciar a API |

3. Subir a API:
   - **Docker**: produção com `docker compose --env-file infra/producao.env -f infra/docker-compose.yml up -d --build` (`10.1.5.14:6177`, definidos em `infra/producao.env`); dev/testes acrescentando `-f infra/docker-compose.dev.yml` (monta `test/` e habilita o `POST /extrair`) → `http://localhost:3010`. Sem `API_BIND_IP`, a porta fica só em `127.0.0.1`. Gera a imagem `alerta-alto-custo` e sobe o container `api-extracao-texto`; `docker ps` deve mostrar `healthy` (`GET /health`).
   - **Linux + pm2** (produção): `sudo APPSERVER_IP=<ip do AppServer> bash infra/setup-linux.sh`, `bash infra/verify-infra.sh`, build em `/opt/api-extracao-texto` e `pm2 start infra/ecosystem.config.cjs --env production` (porta `6177`). Não coloque `API_TOKEN` no `ecosystem.config.cjs`: a variável do pm2 venceria o `.env`.
4. Testar: `.\api-extracao-texto\test\e2e\rodar-fase4.ps1` (Windows/Docker) ou `npm run test:amostras && npm run test:e2e` (Linux).

### 2. Protheus

1. **Parâmetros SX6** (SIGACFG → Ambiente → Cadastros → Parâmetros, filial em branco, tipo C):

   | Parâmetro | Valor |
   |---|---|
   | `Z_NOTIENCA` | `0`, ou o maior recno atual da B71 para começar "a partir de agora" (consulta 1 de [monitoramento.sql](implantacao/monitoramento.sql)). Pode ser criado com `U_OSCRIAZNOT` ([OS_CRIAZNOT.tlpp](levantamento/OS_CRIAZNOT.tlpp)) |
   | `Z_MEDAPIT` | O mesmo valor de `API_TOKEN` do `.env` da API |

2. **SMTP**: o envio sai pela conta `sistema@oestesaude.com.br` (`sender.skymail.net.br:587`, TLS, com autenticação), fixa nas constantes `__SMTP_*` do fonte. Os `MV_REL*` do Protheus não são usados.
3. **Constantes do fonte** (`#DEFINE` no topo de [OS_MEDALTC.tlpp](totvsCustomizacoes/Auditoria/OS_MEDALTC.tlpp); alterar exige recompilar):

   | Constante | Conferir |
   |---|---|
   | `__MAIL_TO` | Caixa que recebe os alertas (hoje aponta para um e-mail pessoal) |
   | `__ENV_PROD` / `__URL_PROD` | Ambiente `CYWSXT_PROD` usa `http://10.1.5.14:6177`; qualquer outro usa `__URL_DEV` (`http://localhost:3010`) |
   | `__CODDEP` | Departamentos da B71 (`{"012"}`; `{}` = todos) |
   | `__DATA_DBG` / `__CODOBJ` | Filtros de depuração. **Vazios em produção** |

4. **Compilar** `OS_MEDALTC.tlpp` no RPO.
5. **Diagnóstico**: rodar `U_chkMEDALTC()`. Ele confere token, watermark, medicamentos, B71 da janela, API + SFTP e SMTP sem gravar nada nem enviar e-mail. Todas as linhas devem sair `[OK]`. Depois, `U_mailMEDALTC()` envia um e-mail de teste para `__MAIL_TO`: confira se chegou (e fora do spam).
6. **Scheduler** (CFGX032): rotina `U_OSMEDALTC`, parâmetros `{'01','01'}`, a cada 15 minutos.

### 3. Rede

| Origem | Destino | Porta |
|---|---|---|
| AppServer de produção (`CYWSXT_PROD`) | `10.1.5.14` (API) | `6177` |
| AppServer dos demais ambientes | `localhost` (API na mesma máquina) | `3010` |
| Máquina da API | `SFTP_PROD_HOST` / `SFTP_DEV_HOST` | `2323` / `1151` |
| Máquina da API | `api.anthropic.com` | `443` |

Não exponha a porta da API na internet. Em produção, libere a `6177` só para o IP do AppServer. Com Docker, a regra vai na chain `DOCKER-USER`, porque o Docker ignora o `ufw` ([implantacao/README.md](implantacao/README.md), passo 1.5).

## Funções do Protheus

| Função | Uso |
|---|---|
| `U_OSMEDALTC(aJob)` | O job (Scheduler) |
| `U_dbgMEDALTC()` | Executa o job manualmente em `01/01` |
| `U_dataMEDALTC("AAAAMMDD")` | Executa o job para as B71 de outra data (aceita também `DD/MM/AAAA`), no fluxo normal: watermark, extração, e-mail |
| `U_chkMEDALTC([cArquivo])` | Diagnóstico sem gravar. Com um `ACB_OBJETO` real, verifica o anexo na API (extração + IA) e mostra quais medicamentos ele dispararia |
| `U_mailMEDALTC([cPara])` | Envia um e-mail de teste pela conta do alerta para `__MAIL_TO` (ou `cPara`, separados por `;`), sem consultar B71 nem gravar |
| `U_tstMEDALTC()` | Teste integrado: roda o job duas vezes e confere que não há reprocessamento. **Só no RPO de teste** |
| `U_OSCRIAZNOT([cValor])` | Cria ou ajusta o `Z_NOTIENCA` |

## Manutenção do dia a dia

| Mudança | Como |
|---|---|
| Incluir ou tirar medicamento | Campo `BR8_ALTCUS` na BR8, com `BR8_CODPAD` `00` ou `20` (precisa ter BA8 correspondente). Vale na próxima execução. Outras tabelas padrão: `__CODPAD_BR8` no fonte + novo patch |
| Ligar ou desligar a IA | `IA_HABILITADA` no `.env` (com `true`, `ANTHROPIC_API_KEY` preenchida) + reiniciar a API. Vale na próxima execução do job |
| Trocar o modelo do Claude | `IA_MODELO` no `.env` + reiniciar a API |
| Mudar a regra do tipo de guia | `__TIP_BE2` / `__TIP_BQV` / `fCfgProc()` no fonte + recompilar |
| Trocar o token | `API_TOKEN` no `.env` + reiniciar a API (pm2: `pm2 restart api-extracao-texto`; Docker: `docker compose -f infra/docker-compose.yml up -d`, pois `docker restart` não relê o `.env`), e `Z_MEDAPIT` no mesmo momento |
| Mudar destinatário ou URL da API | `__MAIL_TO` / `__URL_PROD` no fonte + recompilar |
| Reprocessar uma B71 do dia | Pausar o agendamento e gravar `Z_NOTIENCA` = recno − 1. Reenvia o e-mail dela e das seguintes |
| Verificar B71 de outra data | Pausar o agendamento, gravar `Z_NOTIENCA` = primeiro recno da data − 1 e rodar `U_dataMEDALTC("AAAAMMDD")`. As B71 de hoje acima desse valor são verificadas pela próxima rodada normal (reenvia e-mail das que já tinham sido) |

Não altere o `Z_NOTIENCA` com o job rodando: diminuir reenvia e-mails, aumentar pula registros.

## Estrutura do repositório

| Pasta / arquivo | Conteúdo |
|---|---|
| [totvsCustomizacoes/Auditoria/](totvsCustomizacoes/Auditoria/) | Fonte do job (`OS_MEDALTC.tlpp`), o único que vai para produção |
| [api-extracao-texto/](api-extracao-texto/) | API NestJS (`GET /config`, `POST /medicamentos` e `POST /verificar-sftp`, usados pelo job; `POST /extrair-sftp`, do fonte anterior; `GET /health`; `POST /verificar` e `/extrair`, só para testes), `Dockerfile` e testes |
| [infra/](infra/) | `docker-compose.yml` (produção) e `docker-compose.dev.yml` (dev), provisionamento Linux e pm2 |
| [levantamento/](levantamento/) | Checklist e SQLs para validar tabelas, joins e campos na base |
| [teste-integrado/](teste-integrado/) | Roteiro de teste, `OS_TSTMEDALTC.tlpp` e `conferencia.sql` |
| [implantacao/](implantacao/) | Roteiro de produção, monitoramento, rollback e `monitoramento.sql` |
| [configuracoes.md](configuracoes.md) | Referência de todos os parâmetros |
| [preciso-fazer-o-seguinte-indexed-pie.md](preciso-fazer-o-seguinte-indexed-pie.md) | Especificação técnica e planejamento em etapas |
| [planejamentos/](planejamentos/) | Planejamentos de evoluções (ex.: camada de procedimentos antes da IA) |

Para ir a produção, siga [implantacao/README.md](implantacao/README.md), depois de aprovar o [teste integrado](teste-integrado/README.md).
