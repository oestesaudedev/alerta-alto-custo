-- =============================================================================
-- Amostra etapa 1: medicamentos alto custo — BR8 INNER JOIN BA8
-- Substituir _EMP pelo sufixo físico (ex.: 010 → BR8010, BA8010)
-- =============================================================================

-- 0) Distribuição de BR8_ALTCUS (confirmar literal '1' vs 'S' vs outros)
SELECT
    BR8.BR8_ALTCUS,
    COUNT(*) AS QTD
FROM BR8_EMP BR8
WHERE BR8.D_E_L_E_T_ = ' '
GROUP BY BR8.BR8_ALTCUS
ORDER BY QTD DESC;

-- 1) Carga espelhando fCarregaMed() — premissa: ALTCUS = '1'
SELECT
    BR8.BR8_CODPAD,
    BR8.BR8_CODPSA,
    BR8.BR8_DESCRI,
    BR8.BR8_ALTCUS,
    BA8.BA8_CDPADP,
    BA8.BA8_CODPRO,
    BA8.BA8_DESCRI AS BA8_DESCRI,
    BA8.BA8_DPRINC,
    BA8.BA8_CODTAB
FROM BR8_EMP BR8
INNER JOIN BA8_EMP BA8
    ON BA8.BA8_CDPADP = BR8.BR8_CODPAD
   AND BA8.BA8_CODPRO = BR8.BR8_CODPSA
   AND BA8.D_E_L_E_T_ = ' '
WHERE BR8.D_E_L_E_T_ = ' '
  AND BR8.BR8_ALTCUS = '1'
ORDER BY BR8.BR8_DESCRI;

-- 2) Quantos ALTCUS='1' ficam de fora do INNER JOIN (só BR8, sem BA8)
SELECT COUNT(*) AS QTD_SO_BR8_SEM_BA8
FROM BR8_EMP BR8
WHERE BR8.D_E_L_E_T_ = ' '
  AND BR8.BR8_ALTCUS = '1'
  AND NOT EXISTS (
        SELECT 1
        FROM BA8_EMP BA8
        WHERE BA8.D_E_L_E_T_ = ' '
          AND BA8.BA8_CDPADP = BR8.BR8_CODPAD
          AND BA8.BA8_CODPRO = BR8.BR8_CODPSA
  );

-- 3) Teste alternativo de join com BA8_CODPAD (se a amostra 1 vier vazia e ALTCUS tiver linhas)
/*
SELECT COUNT(*) AS QTD_JOIN_CODPAD
FROM BR8_EMP BR8
INNER JOIN BA8_EMP BA8
    ON BA8.BA8_CODPAD = BR8.BR8_CODPAD
   AND BA8.BA8_CODPRO = BR8.BR8_CODPSA
   AND BA8.D_E_L_E_T_ = ' '
WHERE BR8.D_E_L_E_T_ = ' '
  AND BR8.BR8_ALTCUS = '1';
*/

-- 4) Amostra curta para colar no checklist (top 20)
SELECT TOP 20
    BR8.BR8_CODPSA,
    BR8.BR8_DESCRI,
    BA8.BA8_DESCRI,
    BA8.BA8_DPRINC
FROM BR8_EMP BR8
INNER JOIN BA8_EMP BA8
    ON BA8.BA8_CDPADP = BR8.BR8_CODPAD
   AND BA8.BA8_CODPRO = BR8.BR8_CODPSA
   AND BA8.D_E_L_E_T_ = ' '
WHERE BR8.D_E_L_E_T_ = ' '
  AND BR8.BR8_ALTCUS = '1';

-- Oracle: trocar TOP 20 por FETCH FIRST 20 ROWS ONLY / ROWNUM.
-- Postgres: LIMIT 20.
-- Confirmação documental: BR8_ALTCUS opções 1=Sim; 0=Não (campo C 1).
