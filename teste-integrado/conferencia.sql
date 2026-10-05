-- =============================================================================
-- Etapa 10 - conferencia do teste integrado do OSMEDALTC
-- Substituir o sufixo 010 pelo da empresa e:
--   @DATMOV = data das B71 de teste (AAAAMMDD; hoje, ou o valor de __DATA_DBG)
-- =============================================================================

-- 1) Parametros SX6. O token so tem o tamanho conferido (nao exibir o valor)
SELECT X6_FIL, X6_VAR, X6_TIPO,
       CASE WHEN X6_VAR = 'Z_MEDAPIT' THEN '(' + CAST(LEN(RTRIM(X6_CONTEUD)) AS VARCHAR) + ' caracteres)'
            ELSE X6_CONTEUD END AS CONTEUDO
FROM SX6010
WHERE D_E_L_E_T_ = ' '
  AND X6_VAR IN ('Z_NOTIENCA', 'Z_MEDAPIT', 'MV_RELSERV', 'MV_RELACNT', 'MV_RELFROM',
                 'MV_RELAUTH', 'MV_RELSSL', 'MV_RELTLS');

-- 2) B71 da janela e a situacao de cada uma em relacao ao Z_NOTIENCA
--    Depois da 1a execucao: todas 'VERIFICADA' (salvo falha temporaria registrada no log).
--    Depois da 2a: nenhuma B71 muda de situacao e nenhum e-mail novo chega.
SELECT B71.R_E_C_N_O_ AS B71_RECNO, B71.B71_ALIMOV, B71.B71_RECMOV, B71.B71_SEQUEN,
       CASE WHEN B71.R_E_C_N_O_ <= CAST(RTRIM(SX6.X6_CONTEUD) AS INT) THEN 'VERIFICADA' ELSE 'PENDENTE' END AS SITUACAO
FROM B71010 B71
CROSS JOIN (SELECT TOP 1 X6_CONTEUD FROM SX6010
            WHERE X6_VAR = 'Z_NOTIENCA' AND D_E_L_E_T_ = ' ') SX6
WHERE B71.D_E_L_E_T_ = ' '
  AND B71.B71_CODDEP = '012'
  AND B71.B71_DATMOV = '@DATMOV'
ORDER BY B71.R_E_C_N_O_;

-- 3) Escolha da B71 de teste: B71 da data com anexo no banco de conhecimento.
--    Use levantamento/02-amostra-b71-acb.sql (consulta 2) com @DATMOV e @ULTREC = 0.
--    Para reprocessar a B71 escolhida: Z_NOTIENCA = B71_RECNO - 1 (SX6 ou U_tstMEDALTC("<valor>")).

-- 4) Medicamentos que o job procura e os termos mais provaveis de casar no texto
--    Mesmo filtro de fCarregaMed() com MEDICAMENTO_CRITERIO=altcus: BR8_CODPAD em __CODPAD_BR8; item sem BA8
--    entra so com a BR8_DESCRI. Com MEDICAMENTO_CRITERIO=valor, trocar o "AND BR8.BR8_ALTCUS = '1'" pelo
--    EXISTS da consulta 6 de levantamento/05-campos-valor.sql (contagem do mesmo filtro)
SELECT DISTINCT BR8.BR8_CODPAD, BR8.BR8_CODPSA, BR8.BR8_DESCRI,
       COALESCE(BA8.BA8_DPRINC, ' ') AS BA8_DPRINC, COALESCE(BA8.BA8_DESCRI, ' ') AS BA8_DESCRI
FROM BR8010 BR8
LEFT JOIN BA8010 BA8
    ON BA8.BA8_CDPADP = BR8.BR8_CODPAD
   AND BA8.BA8_CODPRO = BR8.BR8_CODPSA
   AND BA8.D_E_L_E_T_ = ' '
WHERE BR8.D_E_L_E_T_ = ' '
  AND BR8.BR8_ALTCUS = '1'
  AND BR8.BR8_CODPAD IN ('00', '20', '18')
ORDER BY BR8.BR8_CODPSA;

-- Oracle/Postgres: trocar TOP 1, CAST(... AS INT) e o '+' de concatenacao pela sintaxe do SGBD.
