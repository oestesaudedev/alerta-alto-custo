-- =============================================================================
-- Confirma os campos usados na coluna "Valor de tabela" do e-mail (fCarregaVlrTab em OS_MEDALTC.tlpp).
-- Os itens da guia (qtd e "Valor na guia") agora vem da camada de procedimentos: ver 07-b53-tipgui-itens.sql.
-- As consultas 2 e 3 ficam como referencia dos campos de todas as tabelas de itens.
-- Substituir SX3010 pelo SX3 da empresa (ex.: empresa 01 -> SX3010).
-- Campo que nao aparecer aqui: ajustar o nome em fCarregaVlrTab() / fCfgProc().
-- =============================================================================

-- 1) Valor de tabela: BA8_CODTAB -> BD4 (vigencia mais recente)
SELECT X3_ARQUIVO, X3_CAMPO, X3_TIPO, X3_TAMANHO, X3_TITULO, X3_DESCRIC
FROM SX3010
WHERE D_E_L_E_T_ = ' '
  AND X3_CAMPO IN ('BA8_CODTAB', 'BD4_CODTAB', 'BD4_CDPADP', 'BD4_CODPRO',
                   'BD4_CODIGO', 'BD4_VALREF', 'BD4_VIGINI',
                   -- cadastro das tabelas de preco (__TAB_ALIAS / __TAB_CPOS): descricao e Tp.Pad.Saude no e-mail
                   'BF8_CODINT', 'BF8_CODIGO', 'BF8_DESCM', 'BF8_CODPAD')
ORDER BY X3_ARQUIVO, X3_ORDEM;

-- 2) Valor na guia: chave da origem e da tabela de itens
--    BEA -> BE2 | BE4 -> BEJ | B44 -> B45 | B4Q -> BQV | B4A -> B4C
SELECT X3_ARQUIVO, X3_CAMPO, X3_TIPO, X3_TAMANHO, X3_TITULO, X3_DESCRIC
FROM SX3010
WHERE D_E_L_E_T_ = ' '
  AND X3_ARQUIVO IN ('BEA', 'BE4', 'B44', 'B4Q', 'B4A', 'BE2', 'BEJ', 'B45', 'BQV', 'B4C')
  AND (   X3_CAMPO LIKE '%[_]OPEMOV' OR X3_CAMPO LIKE '%[_]CODOPE'
       OR X3_CAMPO LIKE '%[_]ANOAUT' OR X3_CAMPO LIKE '%[_]MESAUT' OR X3_CAMPO LIKE '%[_]NUMAUT'
       OR X3_CAMPO LIKE '%[_]ANOINT' OR X3_CAMPO LIKE '%[_]MESINT' OR X3_CAMPO LIKE '%[_]NUMINT'
       OR X3_CAMPO LIKE '%[_]CODPAD' OR X3_CAMPO LIKE '%[_]CODPRO')
ORDER BY X3_ARQUIVO, X3_ORDEM;

-- 3) Candidatos a campo de valor nos itens da guia (o fonte usa *_VLRAPR)
SELECT X3_ARQUIVO, X3_CAMPO, X3_TIPO, X3_TITULO, X3_DESCRIC
FROM SX3010
WHERE D_E_L_E_T_ = ' '
  AND X3_ARQUIVO IN ('BE2', 'BEJ', 'B45', 'BQV', 'B4C')
  AND X3_TIPO = 'N'
  AND (X3_CAMPO LIKE '%VL%' OR X3_CAMPO LIKE '%VAL%')
ORDER BY X3_ARQUIVO, X3_ORDEM;

-- 4) Conferencia do valor de tabela de um medicamento (trocar o codigo).
--    Lista todas as vigencias; o job usa, por tabela + unidade, a de maior BD4_VIGINI <= hoje.
SELECT BR8.BR8_CODPSA, BR8.BR8_DESCRI, BD4.BD4_CODTAB, BD4.BD4_CODIGO,
       BD4.BD4_VALREF, BD4.BD4_VLMED, BD4.BD4_VIGINI, BD4.BD4_VIGFIM
FROM BR8010 BR8
INNER JOIN BA8010 BA8
    ON BA8.BA8_CDPADP = BR8.BR8_CODPAD
   AND BA8.BA8_CODPRO = BR8.BR8_CODPSA
   AND BA8.D_E_L_E_T_ = ' '
INNER JOIN BD4010 BD4
    ON BD4.BD4_CODTAB = BA8.BA8_CODTAB
   AND BD4.BD4_CDPADP = BA8.BA8_CDPADP
   AND BD4.BD4_CODPRO = BA8.BA8_CODPRO
   AND BD4.D_E_L_E_T_ = ' '
WHERE BR8.D_E_L_E_T_ = ' '
  AND BR8.BR8_ALTCUS = '1'
  AND BR8.BR8_CODPSA = '«codigo»'
ORDER BY BD4.BD4_CODTAB, BD4.BD4_CODIGO, BD4.BD4_VIGINI;

-- 5) Indices da BD4: a vigencia (fSqlBd4Vig) precisa de um que comece por
--    BD4_FILIAL+BD4_CODTAB+BD4_CDPADP+BD4_CODPRO+BD4_CODIGO(+VIGINI). Trocar SIX010 pelo SIX da empresa.
SELECT INDICE, ORDEM, CHAVE, DESCRICAO
FROM SIX010
WHERE D_E_L_E_T_ = ' '
  AND INDICE IN ('BD4', 'BA8')
ORDER BY INDICE, ORDEM;

-- 6) MEDICAMENTO_CRITERIO=valor: quantos itens entram na lista para o MEDICAMENTO_VALOR_MIN (trocar @VLRMIN).
--    Mesmo filtro de fSqlFiltroBr8; com a IA ligada precisa ficar em ate 5000.
DECLARE @VLRMIN NUMERIC(16, 2) = 1500.00;
DECLARE @HOJE CHAR(8) = CONVERT(CHAR(8), GETDATE(), 112);
SELECT COUNT(DISTINCT BR8.BR8_CODPSA) AS QTD_MEDICAMENTOS
FROM BR8010 BR8
WHERE BR8.D_E_L_E_T_ = ' '
  AND BR8.BR8_CODPAD IN ('00', '20', '18')
  AND EXISTS (SELECT 1 FROM BA8010 BA8V
              INNER JOIN BD4010 BD4V
                  ON BD4V.BD4_CODTAB = BA8V.BA8_CODTAB
                 AND BD4V.BD4_CDPADP = BA8V.BA8_CDPADP
                 AND BD4V.BD4_CODPRO = BA8V.BA8_CODPRO
                 AND BD4V.BD4_VALREF > @VLRMIN
                 AND BD4V.BD4_VIGINI <= @HOJE
                 AND BD4V.D_E_L_E_T_ = ' '
                 AND NOT EXISTS (SELECT 1 FROM BD4010 BD4N
                                 WHERE BD4N.BD4_FILIAL = BD4V.BD4_FILIAL
                                   AND BD4N.BD4_CODTAB = BD4V.BD4_CODTAB
                                   AND BD4N.BD4_CDPADP = BD4V.BD4_CDPADP
                                   AND BD4N.BD4_CODPRO = BD4V.BD4_CODPRO
                                   AND BD4N.BD4_CODIGO = BD4V.BD4_CODIGO
                                   AND BD4N.BD4_VIGINI > BD4V.BD4_VIGINI
                                   AND BD4N.BD4_VIGINI <= @HOJE
                                   AND BD4N.D_E_L_E_T_ = ' ')
              WHERE BA8V.BA8_CDPADP = BR8.BR8_CODPAD
                AND BA8V.BA8_CODPRO = BR8.BR8_CODPSA
                AND BA8V.D_E_L_E_T_ = ' ');

-- 7) Cadastro das tabelas de preco (__TAB_ALIAS = BF8): BD4_CODTAB = BF8_CODINT + BF8_CODIGO.
--    Esperado para 0001017: "BRASINDICE MEDICAMENTOS RESTRITO PF", Tp.Pad.Saude 20.
--    Se nao for a BF8, achar a tabela pela tela (X3_TITULO 'Tp.Pad.Sa%') e ajustar __TAB_ALIAS/__TAB_CPOS.
SELECT BF8_CODINT, BF8_CODIGO, BF8_DESCM, BF8_CODPAD
FROM BF8010
WHERE BF8_CODINT + BF8_CODIGO = '0001017'
  AND D_E_L_E_T_ = ' ';

SELECT X3_ARQUIVO, X3_CAMPO, X3_TITULO
FROM SX3010
WHERE D_E_L_E_T_ = ' '
  AND X3_TITULO LIKE 'Tp.Pad.Sa%';

-- Oracle/Postgres: trocar '%[_]XXX' por '%\_XXX' ESCAPE '\' e, na consulta 6, as variaveis por literais.
