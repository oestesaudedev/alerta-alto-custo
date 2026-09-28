# Cadastro SX6 — `Z_NOTIENCA`

Parâmetro que guarda o último `R_E_C_N_O_` da **B71** já verificado pelo job `OSMEDALTC`.

## Dados sugeridos

| Campo SX6 | Valor |
|-----------|-------|
| `X6_VAR` | `Z_NOTIENCA` |
| `X6_TIPO` | `C` (caractere) |
| `X6_DESCRIC` | Ult. Recno B71 job alto custo |
| `X6_DESC1` | Watermark OSMEDALTC — nao alterar manualmente sem necessidade |
| `X6_CONTEUD` | `0` (ou recno de partida) |
| `X6_PROPRI` | `U` (usuário) se o ambiente usar essa convenção |
| `X6_EXPAND` | conforme padrão da base para parâmetros numéricos em char |

Tamanho: o `R_E_C_N_O_` pode passar de 10 dígitos em bases grandes — use conteúdo char com margem (ex. 15–20) ou o padrão já usado em outros watermarks `Z_*` da empresa.

## Opção A — Manual (CFGX017)

1. Abrir **CFGX017** (Parâmetros).
2. Incluir `Z_NOTIENCA` com os dados da tabela acima.
3. Conteúdo inicial: `0` para processar desde o primeiro B71 do filtro, **ou** o `R_E_C_N_O_` a partir do qual se deseja começar (ex.: máximo atual da B71 se só quiser o “a partir de agora”).
4. Conferir com:

```sql
SELECT X6_VAR, X6_CONTEUD, X6_DESCRIC
FROM SX6_EMP
WHERE X6_VAR = 'Z_NOTIENCA'
  AND D_E_L_E_T_ = ' ';
```

## Opção B — ADVPL (`OS_CRIAZNOT.tlpp`)

1. Compilar `levantamento/OS_CRIAZNOT.tlpp` no ambiente.
2. Executar `U_OSCRIAZNOT` (ou `U_dbgCRIAZNOT`) no SmartClient com a empresa/filial corretas.
3. A função cria o parâmetro se não existir e exibe o conteúdo atual.
4. Opcional: passar o valor inicial, ex. `U_OSCRIAZNOT("123456")`.

## Leitura / gravação no job (referência para etapas 5–9)

```advpl
nUltimo := Val(AllTrim(SuperGetMV("Z_NOTIENCA", .F., "0")))
// ... após B71 verificado com sucesso:
PutMV("Z_NOTIENCA", cValToChar(nRecnoB71))
```

Usar o mesmo padrão `PutMV` / gravação SX6 já adotado nos fontes da empresa, se houver wrapper.

## Checklist

- [ ] Parâmetro existe na SX6
- [ ] Conteúdo inicial definido e anotado em `01-checklist-config.md`
- [ ] Confirmado que é o `R_E_C_N_O_` da **B71**, não `B71_RECMOV`
