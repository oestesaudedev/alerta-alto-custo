// Confere a verificação do /verificar-sftp: classificação dos achados da IA e falha da IA virando erro.
// Uso: npm run build && npm run test:verificacao (não precisa da API no ar nem da chave da Anthropic)
require('reflect-metadata');
const { Logger } = require('@nestjs/common');
const { classificarIa } = require('../dist/extracao/verificacao/classificacao-ia');
const { VerificacaoService } = require('../dist/extracao/verificacao/verificacao.service');
const { ListaMedicamentosService } = require('../dist/extracao/verificacao/lista-medicamentos.service');

Logger.overrideLogger(false);

let falhas = 0;

function caso(nome, obtido, esperado) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  const ok = a === b;
  console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${nome}`);
  if (!ok) {
    falhas++;
    console.log(`       obtido:   ${a}`);
    console.log(`       esperado: ${b}`);
  }
}

const MED = [
  { codigo: '001', descricao: 'INFLIXIMABE 100MG', termos: ['INFLIXIMABE'] },
  { codigo: '003', descricao: 'AAS' },
  { codigo: '004', descricao: 'RITUXIMABE 500MG', termos: ['RITUXIMABE'] },
];
const IA = {
  ok: true,
  modelo: 'teste',
  achados: [
    { codigo: '001', termo: 'Remicade', contexto: 'solicitado', confianca: 'media', motivo: 'nome comercial' },
    { codigo: '004', termo: 'Mabthera', contexto: 'solicitado', confianca: 'alta', motivo: 'nome comercial de rituximabe' },
    { codigo: '003', termo: 'A.A.S', contexto: 'solicitado', confianca: 'baixa', motivo: 'abreviacao duvidosa' },
  ],
};
const ACHADOS = [
  { codigo: '001', termo: 'Remicade', origem: 'ia', observacao: 'IA (media): nome comercial' },
  { codigo: '004', termo: 'Mabthera', origem: 'ia', observacao: 'IA (alta): nome comercial de rituximabe' },
];
const AVISO_BAIXA = { tipo: 'confianca-baixa', codigo: '003', observacao: 'IA (baixa): abreviacao duvidosa' };
const AVISO_CORTADO = {
  tipo: 'texto-cortado',
  codigo: '',
  observacao: 'texto maior que IA_MAX_CHARS: a IA leu so o inicio',
};

const config = { get: (_nome, padrao) => padrao };

function servico(extraido, ia) {
  const pedidos = [];
  const extracoes = [];
  const extracao = {
    extrair: async () => (extracoes.push(1), extraido),
    extrairDoSftp: async () => (extracoes.push(1), extraido),
  };
  const iaFalsa = {
    analisar: async (texto, medicamentos, mascarar) => {
      pedidos.push({ texto, medicamentos, mascarar });
      return ia;
    },
  };
  const listas = new ListaMedicamentosService(config);
  return { verificacao: new VerificacaoService(extracao, iaFalsa, listas, config), pedidos, extracoes, listas };
}

async function main() {
  // --- classificação
  caso('alta e média viram achado, baixa vira aviso', classificarIa(IA), { achados: ACHADOS, avisos: [AVISO_BAIXA] });
  caso('sem achados da IA', classificarIa({ ok: true, modelo: 'teste', achados: [] }), { achados: [], avisos: [] });
  caso('texto cortado vira aviso', classificarIa({ ...IA, cortado: true }), {
    achados: ACHADOS,
    avisos: [AVISO_CORTADO, AVISO_BAIXA],
  });

  // --- serviço
  const texto = { ok: true, texto: 'Solicito infliximabe (Remicade) e rituximabe (Mabthera)', metodo: 'pdf-parse' };
  const ok = servico(texto, IA);
  caso(
    'verificação ok: achados e avisos da IA, sem texto',
    await ok.verificacao.verificarDoSftp('guia.pdf', 'X', { medicamentos: MED, mascarar: ['JOAO'] }),
    { ok: true, metodo: 'pdf-parse', modelo: 'teste', candidatos: 2, achados: ACHADOS, avisos: [AVISO_BAIXA] },
  );
  caso('texto, só os candidatos da pré-busca e nomes a mascarar vão para a IA', ok.pedidos[0], {
    texto: texto.texto,
    medicamentos: [MED[0], MED[2]],
    mascarar: ['JOAO'],
  });

  // --- lista registrada (POST /medicamentos)
  const porId = servico(texto, IA);
  const reg = porId.listas.registrar(MED);
  caso('mesma lista, mesmo listaId', porId.listas.registrar([...MED].reverse()).listaId, reg.listaId);
  const rId = await porId.verificacao.verificarDoSftp('guia.pdf', 'X', { listaId: reg.listaId });
  caso('verificação pelo listaId', [rId.ok, rId.candidatos, porId.pedidos[0].medicamentos.map((m) => m.codigo)], [
    true,
    2,
    ['001', '004'],
  ]);
  caso(
    'listaId desconhecido vira erro sem baixar o anexo',
    [await porId.verificacao.verificarDoSftp('guia.pdf', 'X', { listaId: 'x' }), porId.extracoes.length],
    [{ ok: false, erro: 'lista de medicamentos desconhecida: reenviar' }, 1],
  );

  const semCandidato = servico({ ok: true, texto: 'Solicito Remicade', metodo: 'pdf-parse' }, IA);
  await semCandidato.verificacao.verificarDoSftp('guia.pdf', 'X', { medicamentos: MED });
  caso('sem candidato a IA recebe lista vazia', semCandidato.pedidos[0].medicamentos, []);

  const comTexto = servico(texto, IA);
  const r = await comTexto.verificacao.verificar('guia.pdf', 'AAAA', { medicamentos: MED, retornarTexto: true });
  caso('retornarTexto devolve o texto', r.texto, texto.texto);

  const falha = servico(texto, { ok: false, erro: 'timeout' });
  caso(
    'falha da IA vira erro (o job tenta de novo)',
    await falha.verificacao.verificarDoSftp('guia.pdf', 'X', { medicamentos: MED }),
    { ok: false, erro: 'IA indisponivel: timeout' },
  );

  const semArquivo = servico({ ok: false, erro: 'Arquivo não encontrado no SFTP' }, IA);
  caso(
    'erro da extração volta sem chamar a IA',
    [await semArquivo.verificacao.verificarDoSftp('x.pdf', 'X', { medicamentos: MED }), semArquivo.pedidos.length],
    [{ ok: false, erro: 'Arquivo não encontrado no SFTP' }, 0],
  );

  console.log(`\n${falhas === 0 ? 'Todos os testes passaram.' : `${falhas} falha(s).`}`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
