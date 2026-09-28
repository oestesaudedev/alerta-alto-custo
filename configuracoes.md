# Configurações do job OSMEDALTC e da API de extração

Este guia lista tudo o que precisa ser configurado para a solução funcionar, e onde cada item fica. São três lugares:

1. **`.env` da API** (`api-extracao-texto/.env`): token da API e credenciais do SFTP.
2. **Protheus**: parâmetros SX6, constantes do fonte `OS_MEDALTC.tlpp` e o Scheduler.
3. **Rede**: portas que precisam estar liberadas entre as máquinas.

> **Segredos** (token da API e senha do SFTP) ficam só no `.env` da API e na SX6. Não coloque em fonte, README ou repositório. O `.env` já está no `.gitignore`.

---

## 1. API de extração — `api-extracao-texto/.env`

Crie o arquivo a partir do modelo:

```powershell
Copy-Item api-extracao-texto\.env.example api-extracao-texto\.env
```

| Variável | Obrigatória | Exemplo / padrão | Para que serve |
|----------|-------------|------------------|----------------|
| `API_TOKEN` | **Sim** | valor longo e aleatório | Token que o job envia no header `Authorization: Bearer ...`. Tem que ser **igual** ao parâmetro `Z_MEDAPIT` do Protheus |
| `SFTP_HOST` | **Sim** | `oestesaude175831.protheus.cloudtotvs.com.br` | Servidor SFTP dos anexos (sem `sftp://`) |
| `SFTP_PORT` | **Sim** | `1151` | Porta do SFTP (Cloud TOTVS) |
| `SFTP_USER` | **Sim** | `ftp_CYWSXT_dev` | Usuário do SFTP |
| `SFTP_PASSWORD` | **Sim** | — | Senha do SFTP |
| `SFTP_DIR` | **Sim** | `/dirdoc/co01/shared/` | Pasta onde estão os arquivos do `ACB_OBJETO` |
| `PORT` | Não | `3010` | Porta HTTP da API |
| `OCR_TMP_DIR` | Não | `./ocr-tmp` | Pasta temporária dos arquivos durante a extração (apagados ao final) |
| `PDF_MIN_TEXT_CHARS` | Não | `40` | Abaixo dessa quantidade de caracteres, o PDF é tratado como escaneado e vai para OCR |
| `BODY_LIMIT` | Não | `25mb` | Tamanho máximo do JSON recebido (só afeta o `/extrair` com Base64) |

Para gerar um token novo (PowerShell):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Depois de alterar o `.env`, reinicie a API para ela ler os valores novos.

### Rodando no Docker (`infra/docker-compose.yml`)

- O compose lê o `.env` da API (`env_file`), então token e SFTP valem também para o container.
- `PORT`, `OCR_TMP_DIR`, `PDF_MIN_TEXT_CHARS` e `BODY_LIMIT` estão fixos no compose e **têm precedência** sobre o `.env`.
- Porta exposta no computador: `API_HOST_PORT` (padrão `3010`). Em produção use `API_HOST_PORT=6177`, a porta que o Protheus `CYWSXT_PROD` chama.

```powershell
docker compose -f infra/docker-compose.yml up -d --build
```

### Rodando com pm2 (`infra/ecosystem.config.cjs`)

- A API lê o `.env` da pasta `cwd` (`/opt/api-extracao-texto/.env`).
- Porta: `3010` no `env` de desenvolvimento e `6177` no `env_production` (`--env production`).
- O `ecosystem.config.cjs` **não** define `API_TOKEN`: variável de ambiente do pm2 venceria o `.env`. Não acrescente o token nele.

---

## 2. Protheus

### 2.1 Parâmetros SX6

Cadastro em **SIGACFG → Ambiente → Cadastros → Parâmetros**, com filial em branco (vale para todas).

| Parâmetro | Tipo | Valor | Para que serve |
|-----------|------|-------|----------------|
| `Z_NOTIENCA` | C | `0` na primeira vez, ou o recno de partida | Último `R_E_C_N_O_` da **B71** já verificado. O job só processa as B71 acima desse valor e o avança sozinho. Pode ser criado com `U_OSCRIAZNOT()` (`levantamento/OS_CRIAZNOT.tlpp`) |
| `Z_MEDAPIT` | C | o mesmo valor de `API_TOKEN` do `.env` da API | Token Bearer enviado para a API. Vazio: o job registra erro e não processa |
Observações:

- **Não altere `Z_NOTIENCA` à mão** com o job rodando. Diminuir o valor faz o job reprocessar B71 e reenviar e-mails; aumentar faz pular registros.
- Se trocar o `API_TOKEN` da API, troque o `Z_MEDAPIT` junto. Com valores diferentes a API responde 401 e o job não avança.

### 2.2 Constantes no fonte `totvsCustomizacoes/Auditoria/OS_MEDALTC.tlpp`

Ficam como `#DEFINE` no topo do fonte. Alterar exige recompilar.

| Constante | Valor atual | Para que serve |
|-----------|-------------|----------------|
| `__MAIL_TO` | `michel.ramos@oestesaude.com.br` | Destinatário do e-mail de alerta |
| `__API_URL` | `fApiUrl()` | Endereço da API, escolhido pelo ambiente do Protheus (`GetEnvServer()`): `CYWSXT_PROD` (`__ENV_PROD`) usa `http://10.1.5.14:6177/extrair-sftp` (`__URL_PROD`); qualquer outro usa `http://localhost:3010/extrair-sftp` (`__URL_DEV`). Mudar exige recompilar |
| `__CODDEP` | `012` | Departamento filtrado na B71 (`B71_CODDEP`) |
| `__CODOBJ` | `""` (vazio) | Filtro de depuração: preenchido, processa só esse `ACB_CODOBJ`. Em produção, deixe vazio |
| `__DATA_DBG` | `""` (vazio) | Depuração: preenchido com `AAAAMMDD`, a B71 é filtrada por essa data em vez de hoje (teste com B71 antiga). Em produção, deixe vazio |
| `__API_TIMEOUT` | `120` | Tempo máximo (segundos) de espera pela API por anexo |

### 2.3 Scheduler

Cadastro em **Configurador → Scheduler (CFGX032)**:

| Campo | Valor |
|-------|-------|
| Rotina | `U_OSMEDALTC` |
| Parâmetros | `{'01','01'}` (empresa, filial) |
| Recorrência | a cada 15 minutos |

Execuções simultâneas são bloqueadas pelo próprio job (`LockByName`). Para testar manualmente, execute `U_dbgMEDALTC`.

### 2.4 E-mail (SMTP)

O job envia pelo SMTP padrão do Protheus, lendo os parâmetros SX6 abaixo (os mesmos usados pelos envios de e-mail que já funcionam). Normalmente já estão preenchidos; confira antes do teste.

| Parâmetro | Tipo | Exemplo | Para que serve |
|-----------|------|---------|----------------|
| `MV_RELSERV` | C | `smtp.empresa.com.br:587` | Servidor SMTP. A porta pode vir depois de `:` (sem porta, usa 25) |
| `MV_RELACNT` | C | `protheus@empresa.com.br` | Conta usada para autenticar |
| `MV_RELPSW` | C | — | Senha da conta |
| `MV_RELAUTH` | L | `.T.` | Se o servidor exige autenticação |
| `MV_RELSSL` | L | `.F.` | Conexão SSL |
| `MV_RELTLS` | L | `.T.` | Conexão TLS (comum na porta 587) |
| `MV_RELFROM` | C | `protheus@empresa.com.br` | Remetente. Vazio: usa `MV_RELACNT` |

O destinatário é a constante `__MAIL_TO` do fonte (seção 2.2). É enviado **um e-mail por movimentação B71** em que algum medicamento de alto custo foi encontrado. Se o envio falhar, o job não avança o `Z_NOTIENCA` e tenta de novo na próxima execução.

---

## 3. Rede

| Origem | Destino | Porta | Para quê |
|--------|---------|-------|----------|
| AppServer de produção (`CYWSXT_PROD`) | `10.1.5.14` | `6177` (TCP) | O job chama `POST /extrair-sftp` |
| AppServer dos demais ambientes | a própria máquina (`localhost`) | `3010` (TCP) | O job chama `POST /extrair-sftp` |
| Máquina da API | `SFTP_HOST` | `1151` (TCP) | A API baixa os anexos |

- Fora do `CYWSXT_PROD` o job usa `localhost:3010`, então a API precisa estar na **mesma máquina** do AppServer desse ambiente.
- Em produção a API roda em `10.1.5.14` na porta `6177` (pm2 com `--env production`, ou Docker com `API_HOST_PORT=6177`).
- Não exponha a porta da API na internet; libere só na rede interna.

---

## 4. Checklist rápido

- [ ] `api-extracao-texto/.env` criado com `API_TOKEN` e todas as `SFTP_*`
- [ ] API no ar (Docker ou pm2) e respondendo em `http://localhost:3010` (dev) ou `http://10.1.5.14:6177` (produção)
- [ ] Teste da API: `.\api-extracao-texto\test\e2e\rodar-fase4.ps1` (todos os testes OK)
- [ ] SX6 `Z_NOTIENCA` cadastrado
- [ ] SX6 `Z_MEDAPIT` cadastrado com o mesmo valor do `API_TOKEN`
- [ ] Parâmetros SMTP `MV_REL*` conferidos (seção 2.4)
- [ ] Campos de valor do e-mail conferidos com `levantamento/05-campos-valor.sql` (BD4 e itens da guia em `fCfgItens()`); campo ausente só deixa a coluna como `n/d`
- [ ] AppServer alcançando a API: `localhost:3010` fora da produção, `10.1.5.14:6177` no `CYWSXT_PROD` (a linha `Config: ambiente ... | API ...` do log mostra a URL escolhida)
- [ ] `OS_MEDALTC.tlpp` compilado no RPO
- [ ] `U_chkMEDALTC` com todas as verificações `[OK]` (roteiro em `teste-integrado/README.md`)
- [ ] `U_tstMEDALTC` terminando com `Teste integrado OK` e um único e-mail por B71
- [ ] `__DATA_DBG` e `__CODOBJ` vazios antes de compilar para produção
- [ ] Scheduler cadastrado (`U_OSMEDALTC`, `{'01','01'}`, 15 min) — roteiro de produção em `implantacao/README.md`
