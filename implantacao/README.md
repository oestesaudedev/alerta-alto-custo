# Etapa 11 — Implantação do OSMEDALTC em produção

Roteiro para pôr em produção a API de extração e o job `U_OSMEDALTC` no Scheduler a cada 15 minutos. Só comece com a etapa 10 aprovada (`U_tstMEDALTC` terminando com `Teste integrado OK` e o e-mail conferido).

| Arquivo | Para que serve |
|---|---|
| `totvsCustomizacoes/Auditoria/OS_MEDALTC.tlpp` | Único fonte que vai para o RPO de produção |
| `implantacao/monitoramento.sql` | Valor de partida do `Z_NOTIENCA` e situação diária (B71 pendentes) |
| `configuracoes.md` | Referência de todos os parâmetros |
| `infra/` | Provisionamento do servidor da API (`setup-linux.sh`, `verify-infra.sh`, pm2, Docker) |

**Ordem**: suba a API nova (seção 1) **antes** do patch do RPO (seção 2). O fonte atual chama o `GET /config` no início de cada execução (para saber se a IA está ligada) e, com a IA ligada, o `POST /verificar-sftp`; com a API antiga, o `/config` volta HTTP 404 e o job para sem avançar o `Z_NOTIENCA` (o `U_chkMEDALTC()` avisa "API sem o /config: atualizar a API"). A API nova continua atendendo o `/extrair-sftp` do fonte anterior, então pode ir para produção antes do patch sem afetar o job que já roda. Exceção: se estiver no RPO o patch intermediário que chamava o `/verificar-sftp` com os campos `ia` e `retornarTexto`, a API nova o recusa (HTTP 400 "property ia should not exist"); aplique o patch atual logo depois de subir a API.

**Pré-requisito**: a verificação principal é a dos procedimentos lançados na guia, feita no Protheus; confira o `B53_TIPO` e as tabelas de itens com `levantamento/07-b53-tipgui-itens.sql`. A IA é opcional (`IA_HABILITADA`): para ligá-la, antes é preciso a aprovação do envio dos textos à Anthropic e a saída de rede para `api.anthropic.com` (seção 9).

## 1. API em produção

1. **Servidor**: `10.1.5.14`, Linux na rede interna, com saída para o SFTP de produção (`SFTP_PROD_HOST:SFTP_PROD_PORT`, porta `2323`) e alcançável pelo AppServer na porta **6177**. O job, no ambiente `CYWSXT_PROD`, chama fixo `http://10.1.5.14:6177/verificar-sftp` (defines `__URL_PROD` e `__API_PATH` no fonte).
   - `sudo APPSERVER_IP=<ip do AppServer> bash infra/setup-linux.sh` e depois `bash infra/verify-infra.sh` (exit 0). O script instala o Node 22 e, com `APPSERVER_IP`, cria as regras do `ufw` do passo 5.
2. **Código**: em `api-extracao-texto/`, `npm ci && npm run build` e copiar `package.json`, `package-lock.json`, `node_modules/` e `dist/` para `/opt/api-extracao-texto/`. Outra opção é fazer o build direto no servidor.
3. **`.env` de produção** em `/opt/api-extracao-texto/.env`, a partir de `.env.example`:
   - `API_TOKEN`: token **novo**, aleatório, com 32 ou mais caracteres, diferente do de desenvolvimento. A API não sobe com token vazio, curto ou `dev-change-me`.
   - `SFTP_AMBIENTE_PROD=CYWSXT_PROD`, `SFTP_PROD_*` (host, porta `2323`, usuário e senha de **produção**, e `SFTP_PROD_HOSTKEY`) e `SFTP_DIR`. Confira a impressão digital a partir do servidor da API: `ssh-keyscan -p 2323 <SFTP_PROD_HOST> | ssh-keygen -lf -` deve mostrar o mesmo `SHA256:...` do `.env.example`.
   - `IA_HABILITADA`: `false` para alertar só pelos procedimentos da guia; `true` com `ANTHROPIC_API_KEY` (chave da conta da empresa) para o Claude também verificar os anexos; se quiser, `IA_MODELO` (`claude-haiku-4-5` custa menos), `IA_TIMEOUT_MS` e `IA_MAX_CHARS`. A API não sobe com a IA ligada e a chave vazia; com a IA desligada, sobe com aviso no console e o `GET /config` responde `ia: false`.
   - `EXTRAIR_BASE64=false` (ou ausente): o `POST /extrair` fica desligado em produção.
   - `SFTP_DEV_*` **vazios**: a produção não precisa da credencial de dev. Uma chamada com outro ambiente volta "SFTP DEV não configurado".
   - Permissão restrita: `chown ocr: .env && chmod 600 .env`.
4. **Subir**: `pm2 start infra/ecosystem.config.cjs --env production` (sobe na porta 6177), depois `pm2 save` e `pm2 startup` (volta após reboot). O `ecosystem` não define `API_TOKEN`: o token vem só do `.env`.
   - **Docker** como alternativa, com o `.env` de produção em `api-extracao-texto/.env`: `API_BIND_IP=10.1.5.14 API_HOST_PORT=6177 docker compose -f infra/docker-compose.yml up -d --build`. O `restart: unless-stopped` volta após reboot (serviço do Docker habilitado: `systemctl enable docker`). `docker ps` deve mostrar `api-extracao-texto` como `healthy`.
5. **Firewall**: porta 6177 liberada só para o IP do AppServer. Não expor na internet.
   - **pm2**: `ufw allow from <IP_APPSERVER> to any port 6177 proto tcp` e `ufw deny 6177/tcp` (o `setup-linux.sh` faz isso com `APPSERVER_IP`). O `ufw` precisa estar ativo (`ufw status`); antes de ativar, libere o SSH.
   - **Docker**: o Docker grava as próprias regras de iptables e **ignora o `ufw`**. Bloqueie na chain `DOCKER-USER` e torne a regra persistente (`apt install iptables-persistent` e `netfilter-persistent save`):
     ```bash
     sudo iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 6177 --ctdir ORIGINAL ! -s <IP_APPSERVER> -j DROP
     ```
   - Conferir a partir de **outra** máquina da rede (não o AppServer): `curl -m 5 http://10.1.5.14:6177/health` deve dar timeout. Do AppServer deve responder `{"ok":true}`.
6. **Teste a partir do servidor**, sem mostrar o token no histórico:
   ```bash
   read -rs TOKEN && curl -s -X POST http://localhost:6177/verificar-sftp \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"arquivo":"implantacao-teste-inexistente.pdf","ambiente":"CYWSXT_PROD","medicamentos":[{"codigo":"TESTE","descricao":"TESTE"}]}'
   ```
   Esperado: `{"ok":false,"erro":"arquivo não encontrado no SFTP PROD: ..."}`, o que mostra que token e SFTP de **produção** estão OK. Com 401 o token não confere; com `SFTP DEV` na mensagem, o `SFTP_AMBIENTE_PROD` não bate; com outro erro, conferir as `SFTP_PROD_*`. A IA é conferida com um anexo real no diagnóstico do Protheus (seção 2.4).

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

Executar `U_chkMEDALTC()` uma vez. Ele não grava o `Z_NOTIENCA` nem envia e-mail. Todas as linhas devem sair `[OK]`: token, watermark, flag da IA (conferir se diz habilitada ou desabilitada como esperado), medicamentos, B71 da janela (com `B53_TIPO`, tabela de itens e procedimentos de alto custo), API + token + SFTP e SMTP.

Com a IA ligada, depois, `U_chkMEDALTC("<ACB_OBJETO>")` com um anexo real que cite um medicamento de alto custo: deve sair `[OK] Verificacao de <anexo> (extracao + IA) - via <metodo> e <modelo> em <s>s` e a lista dos medicamentos que entrariam no alerta. "IA indisponivel" indica `IA_HABILITADA`, chave ou saída 443 (ver o log da API, `IA falhou ...`).

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
[OSMEDALTC][INFO] Config: ambiente CYWSXT_PROD | API http://10.1.5.14:6177/verificar-sftp | e-mail <__MAIL_TO>
[OSMEDALTC][INFO] IA habilitada (<modelo>): ...   (ou "IA desabilitada (IA_HABILITADA na API): alerta so pelos procedimentos da guia ...")
[OSMEDALTC][INFO] <n> medicamento(s) de alto custo carregado(s) ...
[OSMEDALTC][INFO] Watermark Z_NOTIENCA = <valor>; buscando B71 ...
[OSMEDALTC][INFO] Nenhuma B71 nova.   (ou o resumo "<x> de <y> B71 verificada(s), <z> e-mail(s) enviado(s)")
[OSMEDALTC][INFO] Fim da execucao
```

- Se a linha `Config` mostrar `localhost:3010`, o ambiente não se chama `CYWSXT_PROD` (a comparação ignora maiúsculas): conferir o nome do ambiente no `appserver.ini` antes de seguir.
- `monitoramento.sql`, consulta 2: `PENDENTES` volta a 0 depois de cada execução.
- Cada B71 com guia mostra `(B53_TIPO x, itens BE2|BQV|B4C)` e, em seguida, a chave usada na busca e todos os procedimentos lançados, um por linha, com a tabela de origem; os de alto custo terminam em `| ALTO CUSTO`:

  ```
  itens BE2 da guia (chave da BEA recno 1645352: BE2_OPEMOV+BE2_ANOAUT+BE2_MESAUT+BE2_NUMAUT = 0001 2026 03 00012345): 3 procedimento(s), 1 de alto custo
      [BE2] 00 10101012 - CONSULTA EM CONSULTORIO | qtd 1 | R$ 120,00
      [BE2] 00 90012345 - MEDICAMENTO X | qtd 2 | R$ 8.400,00 | ALTO CUSTO
      [BE2] 00 40301010 - (nao cadastrado na BR8) | qtd 1 | R$ 15,00
  ```

  `nenhum procedimento lancado` com guia que tem itens indica chave ou tabela de itens a conferir (`levantamento/07-b53-tipgui-itens.sql`, consulta 3). A linha final `n item(ns) de alto custo: ...` mostra a tabela nos procedimentos, ex.: `90012345 (Procedimento BE2)`.
- Com a IA ligada, cada anexo verificado aparece como `<anexo>: texto via <método>, IA <modelo> em <s>s, n achado(s)`.
- No log do job, `mascaramento para a IA: n nome(s)/matricula da guia` deve mostrar `n` maior que zero; com `0`, os campos de `__CPO_NOMES` / `__CPO_MATRIC` não existem nas tabelas de origem e precisam ser ajustados no fonte (conferir no SX3).
- O primeiro alerta real chega em `__MAIL_TO` com os dados da guia e dos medicamentos.

## 5. Monitoramento contínuo

| Sinal no log | O que significa | Ação |
|---|---|---|
| `ERROR` "sem resposta da API" / "Token Authorization inválido" | API fora, rede ou token diferente | `pm2 status` / `pm2 logs api-extracao-texto` (Docker: `docker ps` / `docker logs api-extracao-texto`); conferir `Z_MEDAPIT` × `API_TOKEN`. O job retoma sozinho |
| `ERROR` "ambiente should not be empty" | Fonte antigo no RPO, sem o campo `ambiente` | Aplicar o patch atual do `OS_MEDALTC.tlpp`. O job retoma sozinho |
| `ERROR` "SFTP DEV não configurado" na produção | O ambiente do AppServer não se chama `SFTP_AMBIENTE_PROD` (`CYWSXT_PROD`) | Conferir o nome do ambiente e o `.env` |
| `ERROR` "chave do servidor SFTP ... não confere" | O servidor SFTP apresentou outra chave: troca feita pela TOTVS ou servidor falso no caminho | Confirmar com a TOTVS antes de aceitar a chave nova; depois atualizar `SFTP_PROD_HOSTKEY` no `.env` e reiniciar a API. O job retoma sozinho |
| `ERROR` "API ocupada" | Fila de extração cheia (mais de 20 esperando) | Normal só com chamadas de fora do job. O job retoma sozinho |
| `ERROR` "GET /config (flag da IA): ..." | API fora, token diferente ou API antiga sem o `/config` ("API sem o /config") | Nenhuma B71 é processada. Subir/atualizar a API ou conferir `Z_MEDAPIT` × `API_TOKEN`. O job retoma sozinho |
| `ERROR` "Cannot POST /verificar-sftp" | Fonte atual no RPO com a API antiga | Atualizar a API (seção 1). O job retoma sozinho |
| `ERROR` "property ia should not exist" | Patch intermediário no RPO com a API nova | Aplicar o patch atual do `OS_MEDALTC.tlpp`. O job retoma sozinho |
| `ERROR` "IA indisponivel: ..." | IA ligada, mas Claude fora, timeout, chave inválida ou saída 443 bloqueada (ou o flag mudou no meio da execução) | O job para na B71 e a retoma na próxima execução. Ver o log da API (`IA falhou ...`). Para seguir só com os procedimentos, `IA_HABILITADA=false` + reiniciar a API |
| `ERROR` "campo B53_TIPO nao existe no dicionario da B53" | Campo do tipo da guia ausente na base | Job parado nessa B71 até criar/ajustar o campo (ver `levantamento/07-b53-tipgui-itens.sql`) |
| `ERROR` "procedimentos nao verificados: ... nao existe no dicionario" | Campo da tabela de itens (BE2, BQV, B4C) diferente do previsto em `fCfgProc` | A B71 segue sem os procedimentos (sem alerta por eles); corrigir o fonte |
| `ERROR` "procedimentos da guia (itens ...): ..." | Erro na consulta dos itens | O job para na B71 e a retoma na próxima execução |
| `ERROR` "medicamentos should not be empty" ou "descricao must be shorter" | Lista de medicamentos vazia ou com texto acima do limite da API (1000 caracteres por descrição ou termo) | Conferir a BR8/BA8 (`U_chkMEDALTC()` lista os medicamentos). O job retoma quando a lista for aceita |
| `WARN` "[IA] ...: texto maior que IA_MAX_CHARS" | Anexo com texto maior que o limite enviado ao Claude | A IA leu só o início do anexo. Conferir o anexo manualmente ou aumentar `IA_MAX_CHARS` |
| `INFO` "[IA] ... com confianca baixa: fora do alerta" | O Claude achou uma citação duvidosa | Informativo; conferir o anexo se o medicamento for relevante |
| `ERROR` "SMTP ... falha" | Servidor de e-mail indisponível ou credencial | Conferir `MV_REL*`. O e-mail sai na próxima execução |
| `ERROR` "campo ... nao existe no dicionario" | Mapa de guia (`fCampoGuia`) não bate com o dicionário | Job parado nessa B71 até corrigir o fonte |
| `WARN` "... descartado (arquivo não encontrado no SFTP)" | `ACB_OBJETO` não está na pasta do SFTP | Informativo; a B71 segue |
| `WARN` "B71 de dia(s) anterior(es) ficaram sem verificacao" | Job ficou parado ou falhando na virada do dia | Conferir manualmente os anexos dessas B71: o job só verifica o dia corrente |
| `WARN` "lock ativo" frequente | Execução levando mais de 15 min, ou agendamento duplicado | Ver tempo por anexo no log; conferir o Schedule |
| `WARN` "Valor de tabela nao apurado" / coluna `n/d` | Campo de valor da BD4 ausente ou erro na query | Não bloqueia; ver `levantamento/05-campos-valor.sql` |
| Log da API: "PDF com N páginas — OCR só das 30 primeiras" | PDF escaneado maior que `PDF_MAX_PAGINAS` | Informativo; medicamento citado só depois da página 30 não é detectado. Conferir o anexo manualmente se necessário |

Riscos conhecidos, sem correção por ora:
- Os anexos são ligados à guia por `AC9_CODENT LIKE '%guia%'` (`fBuscaAnexos`). Se o `AC9_CODENT` puder conter o número de outra guia como trecho, entram anexos de outra guia. Conferir o formato do campo na base antes do go-live.
- Só as B71 do dia corrente são verificadas (ver aviso "dia(s) anterior(es)").

`PENDENTES > 0` em duas consultas seguidas com mais de 15 minutos de intervalo (consulta 2) indica job parado ou travado numa B71: procurar o `ERROR` no log.

## 6. Rollback

1. **Desativar o agendamento** no Schedule. É imediato e sem efeito colateral: nada é gravado fora do `Z_NOTIENCA`.
   - Para voltar à busca exata sem IA: reaplicar o patch anterior do `OS_MEDALTC.tlpp` (o que chama o `/extrair-sftp` e procura as descrições no texto). A API nova continua atendendo esse endpoint.
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
| Ligar ou desligar a IA | `IA_HABILITADA` no `.env` (com `true`, `ANTHROPIC_API_KEY` preenchida) + reiniciar a API como na troca de token. O job lê o flag na próxima execução |
| Trocar a chave da Anthropic ou o modelo | `ANTHROPIC_API_KEY` / `IA_MODELO` no `.env` + reiniciar a API como na troca de token |
| Reprocessar uma B71 do dia | `Z_NOTIENCA` = recno − 1, com o agendamento pausado. Reenvia o e-mail dessa B71 e das seguintes |
| Verificar B71 de outra data (ex.: dia em que o job ficou parado) | Com o agendamento pausado: `Z_NOTIENCA` = primeiro recno da data − 1 (`U_OSCRIAZNOT("<valor>")`) e `U_dataMEDALTC("AAAAMMDD")`. O watermark avança sobre a data; na próxima rodada normal as B71 de hoje acima dele são verificadas (as que já tinham sido reenviam e-mail) |

## 8. Checklist de go-live

- [ ] Etapa 10 aprovada (`U_tstMEDALTC` OK, e-mail conferido)
- [ ] Credenciais expostas em 28/09/2026 trocadas: `API_TOKEN` de dev (e `Z_MEDAPIT` dos ambientes de teste), `SFTP_DEV_PASSWORD` e `SFTP_PROD_PASSWORD`
- [ ] API de produção no ar em `10.1.5.14:6177` (`pm2 save` feito, ou Docker `healthy`)
- [ ] Firewall só para o AppServer (Docker: regra na `DOCKER-USER`), conferido com `curl` de outra máquina dando timeout
- [ ] `B53_TIPO` e os itens (BE2, BQV, B4C) conferidos com `levantamento/07-b53-tipgui-itens.sql`
- [ ] Se a IA for ligada: envio dos textos à Anthropic aprovado (jurídico/DPO, DPA, ZDR) e saída 443 para `api.anthropic.com` (seção 9)
- [ ] `.env` de produção com token novo (32+ caracteres), `SFTP_PROD_*` com `SFTP_PROD_HOSTKEY` conferido, `SFTP_DIR`, `SFTP_DEV_*` vazios, `IA_HABILITADA` decidido (`true` + `ANTHROPIC_API_KEY`), `EXTRAIR_BASE64` desligado, `chmod 600`
- [ ] `curl` do passo 1.6 devolvendo "arquivo não encontrado no SFTP PROD"
- [ ] `__DATA_DBG` e `__CODOBJ` vazios; `__MAIL_TO` conferido (go-live com `michel.ramos@...`, trocar depois para a caixa da auditoria)
- [ ] Patch aplicado só com `OS_MEDALTC.tlpp`
- [ ] SX6 `Z_NOTIENCA` (valor de partida) e `Z_MEDAPIT` cadastrados
- [ ] Log mostrando `Config: ambiente CYWSXT_PROD | API http://10.1.5.14:6177/verificar-sftp`
- [ ] `U_chkMEDALTC()` com todas as linhas `[OK]` em produção e, com a IA ligada, `U_chkMEDALTC("<ACB_OBJETO>")` com a verificação pela IA `[OK]`
- [ ] Agendamento `U_OSMEDALTC` a cada 15 min ativo
- [ ] Primeiras execuções acompanhadas no log e `PENDENTES` zerando

## 9. IA (Claude)

A IA é opcional: com `IA_HABILITADA=false` o job alerta só pelos procedimentos lançados na guia e nenhum anexo é enviado. Ligada, ela confirma os procedimentos nos anexos e acrescenta medicamentos citados que não foram lançados (referência em `configuracoes.md`, seção 1.1). Antes de ligá-la:

1. **Aprovação**: jurídico/DPO de acordo com o envio do texto dos anexos (dados de saúde, com CPF, CNS, carteirinha, telefone, e-mail, data de nascimento e os nomes do beneficiário e do solicitante mascarados; nomes de terceiros soltos no texto ainda podem passar) à Anthropic. Formalizar os termos comerciais, o DPA e a retenção zero de dados (ZDR) com a Anthropic.
2. **Rede**: saída HTTPS (443) do servidor da API para `api.anthropic.com`. É o único destino externo; a porta 6177 continua fechada para fora. Conferir do servidor: `curl -sI https://api.anthropic.com` deve responder (qualquer código HTTP).
3. **API**: `IA_HABILITADA=true` e `ANTHROPIC_API_KEY` no `.env` (seção 1, passo 3).
4. **Conferência**: `U_chkMEDALTC("<ACB_OBJETO>")` com anexos reais já conhecidos (um com o nome exato do cadastro, um com nome comercial, um sem medicamento de alto custo), comparando a lista com o que a auditoria espera.

Acompanhamento nas primeiras semanas:

- A auditoria confere os alertas: achados errados (ruído) e anexos com medicamento que não geraram alerta (perda). As linhas `[IA] ... com confianca baixa` mostram citações duvidosas que ficaram fora do alerta.
- Custo: log da API (tokens por chamada, `IA claude-...: n achado(s) ... (entrada, cache, saída)`) e painel da Anthropic. Todo anexo gera uma chamada. Para reduzir, `IA_MODELO=claude-haiku-4-5`, conferindo de novo a precisão com os mesmos anexos.

Tempo por anexo: a chamada ao Claude soma até `IA_TIMEOUT_MS` (padrão 60 s) ao OCR, dentro dos 300 s do `__API_TIMEOUT`. Se o log mostrar anexos perto desse limite, reduza `IA_TIMEOUT_MS` ou `PDF_MAX_PAGINAS`.
