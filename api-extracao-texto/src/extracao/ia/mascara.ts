const NOME = '[NOME]';
const CARTEIRINHA = '[CARTEIRINHA]';

const MASCARAS_FIXAS: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[EMAIL]'],
  [/\b\d{4}[.\s]\d{4}[.\s]\d{6}[.\s]\d{2}[.\s-]?\d\b/g, CARTEIRINHA],
  [/\b\d{16,17}\b/g, CARTEIRINHA],
  [/\b\d{3}\s?\d{4}\s?\d{4}\s?\d{4}\b/g, '[CNS]'],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]'],
  [/\(\s?\d{2}\s?\)\s?9?\s?\d{4}[-\s]?\d{4}\b/g, '[TELEFONE]'],
  [/\b\d{2}\s9?\d{4}-\d{4}\b/g, '[TELEFONE]'],
  [/(nasc\w*\.?\s*(?:em)?\s*:?\s*)\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/gi, '$1[DATA]'],
];

// Rótulos de formulário seguidos de nome de pessoa, no início da linha ou de uma coluna (tab, "|" ou 2+ espaços),
// para não pegar texto corrido. "nome" sozinho só vale com ":" ou "-" logo depois, para não pegar "Nome comercial:".
const ROTULOS = new RegExp(
  '((?<=^[ \\t]*|[\\t|]| {2})(?:nome\\s+(?:d[oa]\\s+)?(?:paciente|benefici[aá]ri[oa]|segurad[oa]|m[aã]e|pai|respons[aá]vel)' +
    '|paciente|benefici[aá]ri[oa]|segurad[oa]|usu[aá]ri[oa]|titular|m[aã]e|respons[aá]vel|acompanhante' +
    '|m[eé]dic[oa](?:\\s+(?:solicitante|assistente|respons[aá]vel))?|solicitante|nome)\\s*[:\\-]\\s*)' +
    "((?:[\\p{L}'.]+[ \\t]?){1,6})",
  'gimu',
);

const PARTICULAS = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E', 'DI', 'DU', 'DEL', 'LA']);
const MIN_PARTE = 3;

// Letras com acento e trocas comuns do OCR (I/l/1, O/0, S/5)
const VARIANTES: Record<string, string> = {
  A: 'AÁÀÂÃÄ',
  E: 'EÉÈÊË',
  I: 'IÍÌÎÏl1|',
  O: 'OÓÒÔÕÖ0',
  U: 'UÚÙÛÜ',
  C: 'CÇ',
  N: 'NÑ',
  L: 'Ll1I|',
  S: 'S5',
};

export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function padraoParte(parte: string): string {
  return [...parte].map((ch) => (VARIANTES[ch] ? `[${VARIANTES[ch]}]` : escapar(ch))).join('');
}

// Palavras (normalizadas, 3+ letras) que nunca são mascaradas, para não esconder o medicamento do Claude
export function palavrasProtegidas(textos: string[]): Set<string> {
  const protegidas = new Set<string>();
  for (const t of textos) {
    for (const p of normalizar(t).split(/[^A-Z]+/)) {
      if (p.length >= MIN_PARTE) protegidas.add(p);
    }
  }
  return protegidas;
}

function mascararConhecidos(texto: string, conhecidos: string[], protegidas: Set<string>): string {
  const partes = new Set<string>();
  const numeros: string[] = [];
  for (const item of conhecidos) {
    const digitos = item.replace(/[\s.\-/]/g, '');
    if (/^\d{8,}$/.test(digitos)) {
      numeros.push(digitos);
      continue;
    }
    for (const p of normalizar(item).split(/[^A-Z]+/)) {
      if (p.length >= MIN_PARTE && !PARTICULAS.has(p) && !protegidas.has(p)) partes.add(p);
    }
  }

  let resultado = texto;
  for (const n of numeros) {
    const re = new RegExp(`(?<!\\d)${[...n].join('[\\s.\\-/]?')}(?!\\d)`, 'g');
    resultado = resultado.replace(re, CARTEIRINHA);
  }
  if (partes.size) {
    const alternativas = [...partes].sort((a, b) => b.length - a.length).map(padraoParte).join('|');
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternativas})(?![\\p{L}\\p{N}])`, 'giu');
    resultado = resultado.replace(re, NOME);
  }
  return resultado;
}

function mascararRotulos(texto: string, protegidas: Set<string>): string {
  return texto.replace(ROTULOS, (_m, rotulo: string, valor: string) => {
    const palavras = valor.trimEnd().split(/[ \t]+/);
    const trocadas = palavras.map((p) => (protegidas.has(normalizar(p).replace(/[^A-Z]/g, '')) ? p : NOME));
    return rotulo + trocadas.join(' ') + (/[ \t]$/.test(valor) ? ' ' : '');
  });
}

/**
 * Troca dados pessoais por marcadores antes do envio ao Claude:
 * - e-mail, carteirinha, CNS, CPF, telefone e data de nascimento (padrões fixos);
 * - `conhecidos`: nomes (beneficiário, solicitante) e matrícula informados pelo job, cada parte do nome
 *   com 3+ letras, sem acento e tolerando trocas comuns do OCR;
 * - o que vem depois de rótulos como "Paciente:", "Beneficiário:", "Médico solicitante:".
 * Palavras em `protegidas` (termos dos medicamentos) nunca são trocadas.
 * Nomes soltos no texto, sem rótulo e fora de `conhecidos`, continuam passando.
 */
export function mascarar(texto: string, conhecidos: string[] = [], protegidas: Set<string> = new Set()): string {
  let resultado = MASCARAS_FIXAS.reduce((acc, [re, troca]) => acc.replace(re, troca), texto);
  resultado = mascararConhecidos(resultado, conhecidos, protegidas);
  resultado = mascararRotulos(resultado, protegidas);
  return resultado.replace(/\[NOME\](?:[ \t]+\[NOME\])+/g, NOME);
}
