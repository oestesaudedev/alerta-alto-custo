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
                   'BD4_CODIGO', 'BD4_VALREF', 'BD4_VIGINI')
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

-- Oracle/Postgres: trocar '%[_]XXX' por '%\_XXX' ESCAPE '\'.
