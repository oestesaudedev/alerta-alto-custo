// Confere o mascaramento de dados pessoais feito antes do envio ao Claude.
// Uso: npm run build && npm run test:mascara (não precisa da API no ar nem da chave da Anthropic)
const { mascarar, palavrasProtegidas } = require('../dist/extracao/ia/mascara');

let falhas = 0;

function caso(nome, obtido, deveTer, naoDeveTer) {
  const faltando = deveTer.filter((t) => !obtido.includes(t));
  const sobrando = naoDeveTer.filter((t) => obtido.toUpperCase().includes(t.toUpperCase()));
  const ok = !faltando.length && !sobrando.length;
  console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${nome}`);
  if (!ok) {
    falhas++;
    console.log(`       resultado: ${obtido}`);
    if (faltando.length) console.log(`       faltou: ${faltando.join(', ')}`);
    if (sobrando.length) console.log(`       sobrou: ${sobrando.join(', ')}`);
  }
}

const protegidas = palavrasProtegidas(['INFLIXIMABE 100MG', 'INFLIXIMABE', 'USTEQUINUMABE 45MG', 'RITUXIMABE']);

caso(
  'padrões fixos (CPF, CNS, telefone, e-mail, nascimento, carteirinha)',
  mascarar(
    'CPF 123.456.789-09 CNS 898 0012 3456 7890 tel (11) 98765-4321 a.b@x.com.br ' +
      'nascimento: 01/02/1980 cart 0001.0002.000123.00-1 cod 90123456',
  ),
  ['[CPF]', '[CNS]', '[TELEFONE]', '[EMAIL]', '[DATA]', '[CARTEIRINHA]', '90123456'],
  ['123.456', '98765', '1980', '000123'],
);

caso(
  'nome conhecido: completo, abreviado, sem acento e com erro de OCR',
  mascarar(
    'Paciente João Carlos da Silva, 45 anos. J. C. SILVA em uso de INFLIXIMABE. Sr. Joao Carlos SlLVA retorna.',
    ['JOÃO CARLOS DA SILVA'],
    protegidas,
  ),
  ['[NOME]', 'INFLIXIMABE'],
  ['JOÃO', 'JOAO', 'CARLOS', 'SILVA', 'SlLVA'],
);

caso(
  'matrícula conhecida com separadores',
  mascarar('Carteira: 0001 0002 000123 00 1', ['00010002000123001']),
  ['[CARTEIRINHA]'],
  ['000123'],
);

caso(
  'rótulos de formulário',
  mascarar(
    'Beneficiario: PACIENTE DE TESTE - CPF 123.456.789-09\nNome da mãe: Maria Aparecida\n' +
      'Médico solicitante: Dr. Fulano Beltrano CRM 12345\nNome: Ana Paula',
    [],
    protegidas,
  ),
  ['Beneficiario: [NOME]', 'mãe: [NOME]', 'solicitante: [NOME]', 'Nome: [NOME]', '12345'],
  ['PACIENTE DE TESTE', 'Maria', 'Fulano', 'Ana Paula'],
);

caso(
  'não mascara medicamentos nem "Nome comercial"',
  mascarar(
    'Medicamento solicitado: INFLIXIMABE 100 MG\nNome comercial: REMICADE\nPaciente: Jose Rituximabe Souza',
    ['JOSE RITUXIMABE SOUZA'],
    protegidas,
  ),
  ['INFLIXIMABE 100 MG', 'Nome comercial: REMICADE', 'Rituximabe'],
  ['Jose', 'Souza'],
);

caso(
  'rótulo em texto corrido não é mascarado',
  mascarar('Relato: o paciente - em uso de Remicade desde 2020', [], protegidas),
  ['em uso de Remicade'],
  ['[NOME]'],
);

caso(
  'partícula e parte curta do nome não são mascaradas soltas',
  mascarar('Dose de 5 mg de acordo com o protocolo', ['ANA DE SOUZA'], protegidas),
  ['Dose de 5 mg de acordo'],
  ['[NOME]'],
);

console.log(`\n${falhas === 0 ? 'Todos os testes passaram.' : `${falhas} falha(s).`}`);
process.exit(falhas === 0 ? 0 : 1);
