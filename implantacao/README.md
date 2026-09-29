# Etapa 11 — Implantação do OSMEDALTC em produção

Roteiro para pôr em produção a API de extração e o job `U_OSMEDALTC` no Scheduler a cada 15 minutos. Só comece com a etapa 10 aprovada (`U_tstMEDALTC` terminando com `Teste integrado OK` e o e-mail conferido).

| Arquivo | Para que serve |
|---|---|
| `totvsCustomizacoes/Auditoria/OS_MEDALTC.tlpp` | Único fonte que vai para o RPO de produção |
| `implantacao/monitoramento.sql` | Valor de partida do `Z_NOTIENCA` e situação diária (B71 pendentes) |
| `configuracoes.md` | Referência de todos os parâmetros |
| `infra/` | Provisionamento do servidor da API (`setup-linux.sh`, `verify-infra.sh`, pm2, Docker) |

**Ordem**: aplique o patch do RPO (seção 2) **antes ou junto** da API nova. A API exige o campo `ambiente`, que só o fonte atual envia; com um fonte antigo no RPO, cada anexo volta HTTP 400 e o job para sem avançar o `Z_NOTIENCA`. Não há perda, mas nenhum alerta sai até o patch.

## 1. API em produção

1. **Servidor**: `10.1.5.14`, Linux na rede interna, com saída para o SFTP de produção (`SFTP_PROD_HOST:SFTP_PROD_PORT`, porta `2323`) e alcançável pelo AppServer na porta **6177**. O job, no ambiente `CYWSXT_PROD`, chama fixo `http://10.1.5.14:6177/extrair-sftp` (define `__URL_PROD` no fonte).
   - `sudo bash infra/setup-linux.sh` e depois `bash infra/verify-infra.sh` (exit 0).
2. **Código**: em `api-extracao-texto/`, `npm ci && npm run build` e copiar `package.json`, `package-lock.json`, `node_modules/` e `dist/` para `/opt/api-extracao-texto/`. Outra opção é fazer o build direto no servidor.
3. **`.env` de produção** em `/opt/api-extracao-texto/.env`, a partir de `.env.example`:
   - `API_TOKEN`: token **novo**, longo e aleatório, diferente do de desenvolvimento.
   - `SFTP_AMBIENTE_PROD=CYWSXT_PROD`, `SFTP_PROD_*` (host, porta `2323`, usuário e senha de **produção**) e `SFTP_DIR`.
   - `SFTP_DEV_*` **vazios**: a produção não precisa da credencial de dev. Uma chamada com outro ambiente volta "SFTP DEV não configurado".
   - Permissão restrita: `chown ocr: .env && chmod 600 .env`.
4. **Subir**: `pm2 start infra/ecosystem.config.cjs --env production` (sobe na porta 6177), depois `pm2 save` e `pm2 startup` (volta após reboot). O `ecosystem` não define `API_TOKEN`: o token vem só do `.env`.
   - **Docker** como alternativa, com o `.env` de produção em `api-extracao-texto/.env`: `API_HOST_PORT=6177 docker compose -f infra/docker-compose.yml up -d --build`. O `restart: unless-stopped` volta após reboot (serviço do Docker habilitado: `systemctl enable docker`). `docker ps` deve mostrar `api-extracao-texto` como `healthy`.
5. **Firewall**: porta 6177 liberada só para o IP do AppServer. Não expor na internet.
6. **Teste a partir do servidor**, sem mostrar o token no histórico:
   ```bash
   read -rs TOKEN && curl -s -X POST http://localhost:6177/extrair-sftp \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"arquivo":"implantacao-teste-inexistente.pdf","ambiente":"CYWSXT_PROD"}'
   ```
   Esperado: `{"ok":false,"erro":"arquivo não encontrado no SFTP PROD: ..."}`, o que mostra que token e SFTP de **produção** estão OK. Com 401 o token não confere; com `SFTP DEV` na mensagem, o `SFTP_AMBIENTE_PROD` não bate; com outro erro, conferir as `SFTP_PROD_*`.

## 2. Protheus

### 2.1 Conferir o fonte antes de compilar

Em `OS_MEDALTC.tlpp`:

| Define | Produção |
|---|---|
| `__DATA_DBG` | `""` |
| `__CODOBJ` | `""` |
| `__MAIL_TO` | caixa da auditoria que vai receber os alertas |
| `__CODDEP` | `"012"` |

### 2.2 RPO

- Compilar **só** `OS_MEDALTC.tlpp`. `teste-integrado/OS_TSTMEDALTC.tlpp` não vai para produção. `levantamento/OS_CRIAZNOT.tlpp` é opcional (o parâmetro pode ser criado no Configurador).
- Caminho usual: gerar o patch no TDS a partir do RPO de homologação e aplicar na produção, na janela combinada e com backup do RPO atual.
- Confirmar no TDS (inspetor de objetos do RPO de produção) que `U_OSMEDALTC`, `U_DBGMEDALTC`, `U_DATAMEDALTC` e `U_CHKMEDALTC` estão presentes.

### 2.3 Parâmetros SX6 de produção

Cadastro em **SIGACFG → Ambiente → Cadastros → Parâmetros**, filial em branco, tipo C:

| Parâmetro | Valor |
|---|---|
| `Z_NOTIENCA` | Valor de partida: consulta 1 de `monitoramento.sql` (maior recno da B71), para verificar só as movimentações a partir do go-live |
| `Z_MEDAPIT` | O mesmo `API_TOKEN` do `.env` de produção |

A URL da API não é parâmetro: vem do nome do ambiente. Se existir um `Z_MEDAPIU` de versões anteriores, ele é ignorado e pode ser excluído.

Conferir também os `MV_REL*` do SMTP de produção (`configuracoes.md`, seção 2.4).

### 2.4 Diagnóstico em produção

Executar `U_chkMEDALTC()` uma vez. Ele não grava o `Z_NOTIENCA` nem envia e-mail. Todas as linhas devem sair `[OK]`: token, watermark, medicamentos, B71 da janela, API + token + SFTP e SMTP.

## 3. Scheduler

Em **SIGACFG → Schedule** (cadastro de agendamentos):

| Campo | Valor |
|---|---|
| Rotina | `U_OSMEDALTC` |
| Empresa / filial | `01` / `01` (parâmetro `{'01','01'}`) |
| Recorrência | diária, a cada **15 minutos**, o dia todo |
| Situação | ativo |

- Confirmar que o serviço do Schedule está ativo no AppServer de produção (outros agendamentos rodando no horário).
- Não cadastrar dois agendamentos da mesma rotina. Se acontecer, o `LockByName` impede execuções simultâneas, e a segunda sai com "lock ativo".

## 4. Primeiro dia

Acompanhar as primeiras execuções no arquivo `\logpls\alto_custo_AAAAMMDD.log` do RootPath (um por dia; também no console do AppServer, filtro `OSMEDALTC`). A cada 15 minutos deve aparecer:

```
[OSMEDALTC][INFO] Inicio da execucao (empresa 01, filial 01)
[OSMEDALTC][INFO] Config: ambiente CYWSXT_PROD | API http://10.1.5.14:6177/extrair-sftp | e-mail <__MAIL_TO>
[OSMEDALTC][INFO] <n> medicamento(s) de alto custo carregado(s) ...
[OSMEDALTC][INFO] Watermark Z_NOTIENCA = <valor>; buscando B71 ...
[OSMEDALTC][INFO] Nenhuma B71 nova.   (ou o resumo "<x> de <y> B71 verificada(s), <z> e-mail(s) enviado(s)")
[OSMEDALTC][INFO] Fim da execucao
```

- Se a linha `Config` mostrar `localhost:3010`, o ambiente não se chama `CYWSXT_PROD` (a comparação ignora maiúsculas): conferir o nome do ambiente no `appserver.ini` antes de seguir.
- `monitoramento.sql`, consulta 2: `PENDENTES` volta a 0 depois de cada execução.
- O primeiro alerta real chega em `__MAIL_TO` com os dados da guia e dos medicamentos.

## 5. Monitoramento contínuo

| Sinal no log | O que significa | Ação |
|---|---|---|
| `ERROR` "sem resposta da API" / "Token Authorization inválido" | API fora, rede ou token diferente | `pm2 status` / `pm2 logs api-extracao-texto` (Docker: `docker ps` / `docker logs api-extracao-texto`); conferir `Z_MEDAPIT` × `API_TOKEN`. O job retoma sozinho |
| `ERROR` "ambiente should not be empty" | Fonte antigo no RPO, sem o campo `ambiente` | Aplicar o patch atual do `OS_MEDALTC.tlpp`. O job retoma sozinho |
| `ERROR` "SFTP DEV não configurado" na produção | O ambiente do AppServer não se chama `SFTP_AMBIENTE_PROD` (`CYWSXT_PROD`) | Conferir o nome do ambiente e o `.env` |
| `ERROR` "SMTP ... falha" | Servidor de e-mail indisponível ou credencial | Conferir `MV_REL*`. O e-mail sai na próxima execução |
| `ERROR` "campo ... nao existe no dicionario" | Mapa de guia (`fCampoGuia`) não bate com o dicionário | Job parado nessa B71 até corrigir o fonte |
| `WARN` "... descartado (arquivo não encontrado no SFTP)" | `ACB_OBJETO` não está na pasta do SFTP | Informativo; a B71 segue |
| `WARN` "B71 de dia(s) anterior(es) ficaram sem verificacao" | Job ficou parado ou falhando na virada do dia | Conferir manualmente os anexos dessas B71: o job só verifica o dia corrente |
| `WARN` "lock ativo" frequente | Execução levando mais de 15 min, ou agendamento duplicado | Ver tempo por anexo no log; conferir o Schedule |
| `WARN` "valor ... nao apurado" / colunas `n/d` | Campo de valor ausente ou erro na query de valor | Não bloqueia; ver `levantamento/05-campos-valor.sql` |
| Log da API: "PDF com N páginas — OCR só das 30 primeiras" | PDF escaneado maior que `PDF_MAX_PAGINAS` | Informativo; medicamento citado só depois da página 30 não é detectado. Conferir o anexo manualmente se necessário |

Riscos conhecidos, sem correção por ora:
- Os anexos são ligados à guia por `AC9_CODENT LIKE '%guia%'` (`fBuscaAnexos`). Se o `AC9_CODENT` puder conter o número de outra guia como trecho, entram anexos de outra guia. Conferir o formato do campo na base antes do go-live.
- Só as B71 do dia corrente são verificadas (ver aviso "dia(s) anterior(es)").

`PENDENTES > 0` em duas consultas seguidas com mais de 15 minutos de intervalo (consulta 2) indica job parado ou travado numa B71: procurar o `ERROR` no log.

## 6. Rollback

1. **Desativar o agendamento** no Schedule. É imediato e sem efeito colateral: nada é gravado fora do `Z_NOTIENCA`.
2. Se necessário, retirar `OS_MEDALTC.tlpp` do RPO (patch de remoção) e parar a API (`pm2 stop api-extracao-texto`, ou `docker compose -f infra/docker-compose.yml down`).

Ao reativar, o job retoma do `Z_NOTIENCA`, mas só verifica B71 do dia corrente: as de dias em que ficou desligado não são processadas (o aviso de "dia(s) anterior(es)" lista quantas).

## 7. Manutenção

| Mudança | Como |
|---|---|
| Trocar o token | `API_TOKEN` no `.env` + `pm2 restart api-extracao-texto` (Docker: `docker compose -f infra/docker-compose.yml up -d`, que recria o container com o `.env` novo) e `Z_MEDAPIT` no mesmo momento |
| Atualizar a API (Docker) | `git pull` + `API_HOST_PORT=6177 docker compose -f infra/docker-compose.yml up -d --build` |
| Mudar o servidor ou a porta da API | `__URL_PROD` (ou `__ENV_PROD`, se o ambiente mudar de nome) no fonte + novo patch |
| Mudar o destinatário | `__MAIL_TO` no fonte + novo patch |
| Incluir ou tirar medicamento | Campo `BR8_ALTCUS` na BR8 (vale a partir da próxima execução) |
| Reprocessar uma B71 do dia | `Z_NOTIENCA` = recno − 1, com o agendamento pausado. Reenvia o e-mail dessa B71 e das seguintes |
| Verificar B71 de outra data (ex.: dia em que o job ficou parado) | Com o agendamento pausado: `Z_NOTIENCA` = primeiro recno da data − 1 (`U_OSCRIAZNOT("<valor>")`) e `U_dataMEDALTC("AAAAMMDD")`. O watermark avança sobre a data; na próxima rodada normal as B71 de hoje acima dele são verificadas (as que já tinham sido reenviam e-mail) |

## 8. Checklist de go-live

- [ ] Etapa 10 aprovada (`U_tstMEDALTC` OK, e-mail conferido)
- [ ] Credenciais expostas em 28/09/2026 trocadas: `API_TOKEN` de dev (e `Z_MEDAPIT` dos ambientes de teste), `SFTP_DEV_PASSWORD` e `SFTP_PROD_PASSWORD`
- [ ] API de produção no ar em `10.1.5.14:6177` (`pm2 save` feito, ou Docker `healthy`), firewall só para o AppServer
- [ ] `.env` de produção com token novo, `SFTP_PROD_*` e `SFTP_DIR`, `SFTP_DEV_*` vazios, `chmod 600`
- [ ] `curl` do passo 1.6 devolvendo "arquivo não encontrado no SFTP PROD"
- [ ] `__DATA_DBG` e `__CODOBJ` vazios; `__MAIL_TO` conferido (go-live com `michel.ramos@...`, trocar depois para a caixa da auditoria)
- [ ] Patch aplicado só com `OS_MEDALTC.tlpp`
- [ ] SX6 `Z_NOTIENCA` (valor de partida) e `Z_MEDAPIT` cadastrados
- [ ] Log mostrando `Config: ambiente CYWSXT_PROD | API http://10.1.5.14:6177/extrair-sftp`
- [ ] `U_chkMEDALTC()` com todas as linhas `[OK]` em produção
- [ ] Agendamento `U_OSMEDALTC` a cada 15 min ativo
- [ ] Primeiras execuções acompanhadas no log e `PENDENTES` zerando
