// Confere a pré-busca local que escolhe os candidatos enviados à IA.
// Uso: npm run build && npm run test:pre-busca (não precisa da API no ar nem da chave da Anthropic)
const { montarIndice, buscarCandidatos } = require('../dist/extracao/verificacao/pre-busca');

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
  { codigo: '001', descricao: 'INFLIXIMABE 100MG PO LIOF FR-AMP', termos: ['INFLIXIMABE'] },
  { codigo: '002', descricao: 'RITUXIMABE 500MG SOLUCAO INJETAVEL', termos: ['RITUXIMABE'] },
  { codigo: '003', descricao: 'USTEQUINUMABE 45MG SERINGA PREENCHIDA', termos: ['USTEQUINUMABE'] },
  { codigo: '004', descricao: 'ACIDO ZOLEDRONICO 4MG', termos: ['ZOLEDRONICO'] },
];
// Muitos itens com a mesma palavra: ela fica "comum" e não traz candidato sozinha
for (let i = 0; i < 30; i++) {
  MED.push({ codigo: `9${String(i).padStart(2, '0')}`, descricao: `GENERICOX VARIANTE${String.fromCharCode(65 + i)}` });
}
const indice = montarIndice(MED, 20);
const codigos = (texto, max = 50) => buscarCandidatos(indice, texto, max).candidatos.map((m) => m.codigo);

caso('nome exato', codigos('Solicito infliximabe 5mg/kg'), ['001']);
caso('acento e caixa', codigos('uso de RITUXÍMABE'), ['002']);
caso('erros de OCR (l/1/0)', codigos('lNFL1XIMABE e ustequ1numabe'), ['001', '003']);
caso('uma letra a menos', codigos('INFLIXIMAB'), ['001']);
caso('uma letra trocada', codigos('RITUXIMABO'), ['002']);
caso('uma letra a mais', codigos('USTEQUINUMMABE'), ['003']);
caso('unidade e forma não trazem candidato', codigos('100 MG COMPRIMIDO SOLUCAO INJETAVEL SERINGA PREENCHIDA'), []);
caso('sal sozinho não traz candidato', codigos('ACIDO ACETILSALICILICO'), []);
caso('palavra comum não traz candidato sozinha', codigos('GENERICOX'), []);
caso('palavra comum soma com a específica', codigos('GENERICOX VARIANTEC'), ['902']);
caso('texto sem medicamento', codigos('Paciente com dor lombar, repouso.'), []);
caso('palavra curta demais para aproximação', codigos('ZOLE'), []);

caso(
  'item só com palavra comum conta como sem palavra-chave',
  montarIndice([...MED, { codigo: 'X1', descricao: 'GENERICOX 10MG' }, { codigo: 'X2', descricao: '100MG COMP' }], 20).semPalavra,
  2,
);

const corte = buscarCandidatos(indice, 'infliximabe rituximabe ustequinumabe', 2);
caso('corte no máximo com flag', [corte.candidatos.length, corte.total, corte.cortado], [2, 3, true]);

// Desempenho com uma lista do tamanho da produção
function letras(n) {
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  } while (n);
  return s;
}
const grande = [];
for (let i = 0; i < 30000; i++) {
  const nome = `MEDIC${letras(i)}ABE`;
  grande.push({ codigo: String(i), descricao: `${nome} 100MG COMPRIMIDO`, termos: [nome, 'CLORIDRATO DE ' + nome] });
}
let t = Date.now();
const idxGrande = montarIndice(grande, 500);
const tIndice = Date.now() - t;
const texto = `${'Paciente em acompanhamento ambulatorial com evolucao estavel. '.repeat(1500)} solicito ${grande[12345].termos[0]}`;
t = Date.now();
const r = buscarCandidatos(idxGrande, texto, 300);
const tBusca = Date.now() - t;
console.log(`       30000 itens: índice em ${tIndice} ms, busca em ${tBusca} ms (${texto.length} caracteres)`);
caso('lista grande acha o item citado', r.candidatos.map((m) => m.codigo), ['12345']);

console.log(`\n${falhas === 0 ? 'Todos os testes passaram.' : `${falhas} falha(s).`}`);
process.exit(falhas === 0 ? 0 : 1);
