# Etapa 10 — Teste integrado do OSMEDALTC

Roteiro para validar o job de ponta a ponta no Protheus de teste: B71 → B53 (tipo da guia) → procedimentos de alto custo → (IA ligada) anexos → API/SFTP → e-mail → `Z_NOTIENCA`. A 2ª execução não pode reprocessar B71 nem reenviar e-mail. Rodar o roteiro com a IA desligada e ligada (`IA_HABILITADA` no `.env` da API, reiniciando a API a cada troca).

| Arquivo | Para que serve |
|---|---|
| `totvsCustomizacoes/Auditoria/OS_MEDALTC.tlpp` | Job. `U_chkMEDALTC` (diagnóstico, não grava nada) e `U_dbgMEDALTC` (execução manual) |
| `teste-integrado/OS_TSTMEDALTC.tlpp` | `U_tstMEDALTC`: roda o job 2 vezes e confere o watermark. **Só no RPO de teste** |
| `teste-integrado/conferencia.sql` | Parâmetros SX6, situação das B71 da janela e medicamentos procurados |
| `levantamento/OS_CRIAZNOT.tlpp` | Cria/ajusta o `Z_NOTIENCA` |

## 1. Pré-requisitos

- API no ar e com os testes passando: `.\api-extracao-texto\test\e2e\rodar-fase4.ps1`.
- API alcançável pelo AppServer na URL do ambiente: fora do `CYWSXT_PROD` o job usa `http://localhost:3010`, então a API precisa estar na mesma máquina do AppServer; no `CYWSXT_PROD`, `http://10.1.5.14:6177`. A API precisa ser a versão com o `GET /config` e o `/verificar-sftp`. A linha `Config: ambiente ... | API ...` do log mostra a URL escolhida.
- `B53_TIPO` existe no dicionário da B53 e a chave dos itens bate com o `B53_NUMGUI`: `levantamento/07-b53-tipgui-itens.sql`.
- SX6: `Z_NOTIENCA` (via `U_OSCRIAZNOT`) e `Z_MEDAPIT` com o mesmo valor do `API_TOKEN` do `.env` da API.
- SMTP: `MV_RELSERV`, `MV_RELACNT`, `MV_RELPSW`, `MV_RELAUTH`, `MV_RELSSL`, `MV_RELTLS`, `MV_RELFROM` (ver `configuracoes.md`).
- `__MAIL_TO` apontando para uma caixa que você consegue ler.

## 2. Compilar

No RPO de **teste**, compilar `OS_MEDALTC.tlpp`, `OS_TSTMEDALTC.tlpp` e, se o parâmetro ainda não existir, `OS_CRIAZNOT.tlpp`.

Para chamar as funções: no VS Code (TDS), "TOTVS Language Debug" e informar o programa (`U_chkMEDALTC`, `U_tstMEDALTC`...), ou colocar a função como programa inicial do SmartClient. Todas abrem o ambiente `01/01` sozinhas se não houver um aberto. O resultado sai no console do AppServer (`ConOut`) e no log do framework; as mensagens do `OS_MEDALTC.tlpp` (`U_chkMEDALTC`, job) também vão para `\logpls\alto_custo_AAAAMMDD.log` no RootPath.

## 3. Diagnóstico — `U_chkMEDALTC()`

Confere cada peça **sem gravar `Z_NOTIENCA` e sem enviar e-mail**. Todas as linhas devem sair `[OK]`:

| Verificação | Se sair `[FALHA]` |
|---|---|
| Token `Z_MEDAPIT` | Cadastrar o parâmetro com o valor do `API_TOKEN` |
| Watermark `Z_NOTIENCA` | Rodar `U_OSCRIAZNOT`; o conteúdo tem de ser só dígitos |
| Flag da IA (`GET /config`) | API fora do alcance, token diferente ou API antiga sem o `/config`. Com `[OK]`, a linha diz se a IA está habilitada ou desabilitada: conferir com o `IA_HABILITADA` do `.env` |
| Medicamentos de alto custo | Nenhum `BR8_ALTCUS = '1'` com BA8 (conferir com `conferencia.sql`, consulta 4) |
| B71 na janela | Lista as B71 com o status, o `B53_TIPO` e a tabela de itens (BE2, BQV ou B4C) e, para cada guia, a chave da busca e todos os procedimentos lançados (`[BE2] codpad codigo - descrição \| qtd \| valor`, com `\| ALTO CUSTO` nos de alto custo). Falha se houver `CAMPO_GUIA_INEXISTENTE` (corrigir o mapa em `fCampoGuia`), `CAMPO_B53_INEXISTENTE` (`B53_TIPO` fora do dicionário) ou erro na consulta dos itens |
| API + token + SFTP | O job pede um arquivo que não existe; o esperado é a API responder "não encontrado no SFTP". Outra mensagem indica API fora do alcance do AppServer, token diferente (401) ou SFTP inacessível |
| SMTP | Conexão/autenticação com os `MV_REL*` |

Com a IA ligada e um arquivo real, `U_chkMEDALTC("<ACB_OBJETO>")` extrai o texto e lista os medicamentos que seriam detectados, sem enviar nada. É o jeito de escolher um anexo que gere alerta. Com a IA desligada, o arquivo é ignorado (o job não enviaria anexos). Se o TDS não aceitar argumentos na chamada, teste o download real pela API com `SFTP_ARQUIVO=<nome>` no `rodar-fase4.ps1`.

## 4. Preparar a B71 de teste

1. Escolher uma B71 do departamento `012` cuja guia tenha procedimento com `BR8_ALTCUS = '1'` (`levantamento/07-b53-tipgui-itens.sql`, consultas 3 e 4) e, para o teste com a IA ligada, anexo que cite um medicamento de alto custo (`levantamento/02-amostra-b71-acb.sql`, consulta 2).
2. Se a B71 não for de hoje, preencher `#DEFINE __DATA_DBG "AAAAMMDD"` com o `B71_DATMOV` dela e recompilar. O job registra um `WARN` enquanto estiver preenchido.
3. Posicionar `Z_NOTIENCA` em `B71_RECNO - 1`: pelo Configurador (SX6), por `U_OSCRIAZNOT("<valor>")` ou direto no passo 5 com `U_tstMEDALTC("<valor>")`.

## 5. Teste de repetição — `U_tstMEDALTC()`

Roda `U_OSMEDALTC` duas vezes seguidas e confere:

- `[OK] 1a execucao leu o Z_NOTIENCA`
- `[OK] Z_NOTIENCA gravado = ultima B71 verificada na 1a`
- `[OK] 2a execucao partiu do Z_NOTIENCA da 1a`
- `[OK] 2a execucao sem B71 para processar e sem e-mail`, quando não chegou B71 nova entre as duas

Termina com `=== Teste integrado OK ===`. Avisos esperados:
- "1a execucao nao tinha B71 na janela": o teste não exercitou o pipeline; refazer o passo 4.
- "1a execucao parou em falha temporaria": API, SFTP ou SMTP falharam. A 2ª execução retoma a B71, como previsto; corrigir a causa pelo log e repetir.

Sem o `U_tstMEDALTC`, o mesmo teste é manual: `U_dbgMEDALTC`, anotar o `Z_NOTIENCA` (consulta 1), `U_dbgMEDALTC` de novo e conferir no log `Watermark Z_NOTIENCA = <valor anotado>` e `Nenhuma B71 nova.`

## 6. Conferir o resultado

- **E-mail** em `__MAIL_TO`: assunto `[Alto custo] Guia <guia> - <n> item(ns) de alto custo`, com guia, tipo da guia (B53), origem, B71 e, por item, código, descrição, detecção, quantidade, valor de tabela e valor na guia. Com a IA ligada, também termo, anexo e observação da IA. Nenhum trecho do texto do anexo.
- **Uma única mensagem** por B71: a 2ª execução não pode gerar outra.
- **`conferencia.sql`**, consulta 2: todas as B71 da janela como `VERIFICADA`.
- **Log**: nenhuma linha com o conteúdo do anexo, só tamanho, método e tempo.
- Valor de tabela com `n/d`: conferir os campos com `levantamento/05-campos-valor.sql`. Não bloqueia o job.

Cenários da camada de procedimentos:

| Cenário | Esperado |
|---|---|
| IA desligada, guia com procedimento de alto custo | Log `IA desabilitada ...`; nenhum anexo enviado à API; e-mail com a detecção "Procedimento" e sem as colunas da IA |
| IA desligada, guia sem procedimento de alto custo | `nenhum item de alto custo na guia`, sem e-mail, watermark avança |
| IA ligada, procedimento citado no anexo | Detecção "Procedimento + IA", observação "confirmado pela IA: ..." |
| IA ligada, procedimento não citado no anexo | Detecção "Procedimento", observação "nao citado nos anexos" |
| IA ligada, guia sem anexo | Detecção "Procedimento", observação "sem anexo para confirmar" |
| IA ligada, medicamento só no anexo | Detecção "Anexo (IA)", valor na guia "nao consta" |
| `B53_TIPO` 11 em B71 com `B71_ALIMOV = B4Q` | Log da B71 com `itens BQV` e os procedimentos com `[BQV]` |
| `B53_TIPO` 1, 2, 3, 4, 5 ou 7 / outro | Log da B71 com `itens BE2` / `itens B4C` e os procedimentos com `[BE2]` / `[B4C]` |
| B71 da BEA com `BEA_GUIORI` vazio | Log `guia <chave> pela chave da BEA` (antes: "campo da guia vazio") e itens da BE2 com `chave da BEA recno <B71_RECMOV>` |
| Guia com itens, mas log `nenhum procedimento lancado` | Chave ou tabela de itens diferente na base: conferir com `levantamento/07-b53-tipgui-itens.sql` (consulta 3) |

## 7. Cenários de falha (recomendado)

| Cenário | Como provocar | Esperado |
|---|---|---|
| API fora | Parar o container da API e rodar `U_dbgMEDALTC` | `ERROR` no `GET /config` (flag da IA), nenhuma B71 processada, `Z_NOTIENCA` não avança; ao subir a API, a próxima execução retoma dali |
| Token errado | Alterar `Z_MEDAPIT` | 401 da API, `Z_NOTIENCA` não avança |
| SMTP fora | `MV_RELSERV` inválido | "falha na conexao", `Z_NOTIENCA` não avança; o e-mail sai na próxima execução |
| Anexo inexistente | B71 cujo `ACB_OBJETO` não está no SFTP | `WARN ... descartado`, a B71 é concluída e o watermark avança |
| Execução concorrente | Duas sessões com `U_dbgMEDALTC` ao mesmo tempo | A segunda loga "lock ativo" e encerra |

Voltar as configurações ao normal depois de cada cenário.

## 8. Antes da etapa 11 (implantação)

- `__DATA_DBG` e `__CODOBJ` de volta para `""`.
- `Z_NOTIENCA` num valor coerente com a produção. Com `0` o job só pega as B71 do dia, por causa do filtro de data.
- `OS_TSTMEDALTC.tlpp` **fora** do RPO de produção.
- Registrar a data do teste e o resultado na tabela de etapas da spec.
