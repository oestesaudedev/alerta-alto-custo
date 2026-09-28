-- =============================================================================
-- Etapa 11 - valor de partida do Z_NOTIENCA e monitoramento do OSMEDALTC em producao
-- Substituir o sufixo 010 pelo da empresa. Datas no formato AAAAMMDD.
-- =============================================================================

-- 1) Valor de partida do Z_NOTIENCA no go-live: maior recno da B71 (so B71 gravadas a partir de agora).
--    Com 0, a primeira execucao verifica todas as B71 do dia (alertas retroativos) e o aviso de
--    "B71 de dia(s) anterior(es)" lista o historico inteiro ate o watermark passar da primeira B71 do dia.
SELECT ISNULL(MAX(B71.R_E_C_N_O_), 0) AS Z_NOTIENCA_PARTIDA
FROM B71010 B71;

-- 2) Situacao do dia: watermark x B71 pendentes.
--    Pendentes > 0 em duas consultas com mais de 15 min de intervalo = job parado ou travado
--    numa B71 (ver o log do AppServer).
SELECT CAST(RTRIM(SX6.X6_CONTEUD) AS INT) AS Z_NOTIENCA,
       COUNT(B71.R_E_C_N_O_) AS B71_DO_DIA,
       SUM(CASE WHEN B71.R_E_C_N_O_ > CAST(RTRIM(SX6.X6_CONTEUD) AS INT) THEN 1 ELSE 0 END) AS PENDENTES,
       MIN(CASE WHEN B71.R_E_C_N_O_ > CAST(RTRIM(SX6.X6_CONTEUD) AS INT) THEN B71.R_E_C_N_O_ END) AS PRIMEIRA_PENDENTE
FROM (SELECT TOP 1 X6_CONTEUD FROM SX6010
      WHERE X6_VAR = 'Z_NOTIENCA' AND D_E_L_E_T_ = ' ') SX6
LEFT JOIN B71010 B71
    ON B71.D_E_L_E_T_ = ' '
   AND B71.B71_CODDEP = '012'
   AND B71.B71_DATMOV = CONVERT(VARCHAR(8), GETDATE(), 112)
GROUP BY SX6.X6_CONTEUD;

-- B71 de dias anteriores que ficaram sem verificar (job parado na virada do dia) nao aparecem
-- aqui depois que o watermark passa por elas. O proprio job avisa no log, na primeira execucao
-- do dia: "B71 de dia(s) anterior(es) ficaram sem verificacao".

-- Oracle/Postgres: trocar ISNULL, TOP 1, CONVERT/GETDATE e CAST(... AS INT) pela sintaxe do SGBD.
