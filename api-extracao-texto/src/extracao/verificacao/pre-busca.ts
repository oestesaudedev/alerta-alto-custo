import { MedicamentoDto } from '../dto/extrair.dto';
import { normalizar } from '../ia/mascara';

// Pré-busca local: acha no texto os medicamentos da lista cujas palavras-chave aparecem (com tolerância a OCR),
// para que a IA receba só esses candidatos e não a lista inteira.

const MIN_LETRAS = 4;
// Palavras a partir deste tamanho também casam com uma letra a mais, a menos ou trocada
const MIN_APROX = 6;
const PESO_EXATO = 2;
const PESO_APROX = 1;

// Unidades, formas farmacêuticas, embalagem e sais: não identificam o medicamento
const IGNORADAS_BASE = [
  'ACIDO', 'ACETATO', 'BESILATO', 'BROMIDRATO', 'CALCICO', 'CALCICA', 'CITRATO', 'CLORIDRATO', 'DIPROPIONATO',
  'FOSFATO', 'FUMARATO', 'HEMIFUMARATO', 'MALEATO', 'MESILATO', 'POTASSICO', 'POTASSICA', 'PROPIONATO', 'SODICO',
  'SODICA', 'SUCCINATO', 'SULFATO', 'TARTARATO', 'VALERATO', 'MONOIDRATADO', 'DIIDRATADO', 'TRIIDRATADO',
  'COMP', 'COMPRIMIDO', 'COMPRIMIDOS', 'CAPS', 'CAPSULA', 'CAPSULAS', 'SOLUCAO', 'INJETAVEL', 'INJ', 'FRASCO',
  'FRASCOS', 'AMPOLA', 'AMPOLAS', 'LIOF', 'LIOFILIZADO', 'SUSP', 'SUSPENSAO', 'REVEST', 'REVESTIDO', 'REVESTIDOS',
  'CAIXA', 'BLISTER', 'ENVELOPE', 'SERINGA', 'SERINGAS', 'PREENCH', 'PREENCHIDA', 'PREENCHIDAS', 'CANETA',
  'CANETAS', 'APLICADOR', 'ORAL', 'GOTAS', 'XAROPE', 'CREME', 'POMADA', 'ADESIVO', 'DILUENTE', 'EMBALAGEM',
  'HOSPITALAR', 'UNIDADE', 'UNIDADES', 'DOSE', 'DOSES', 'MULTIDOSE', 'PARA', 'USO', 'ADULTO', 'PEDIATRICO',
  'INFUSAO', 'INTRAVENOSO', 'INTRAVENOSA', 'SUBCUTANEO', 'SUBCUTANEA', 'INTRAMUSCULAR', 'BOLSA', 'SISTEMA',
  'FECHADO', 'GENERICO', 'SIMILAR', 'REFERENCIA', 'LIBERACAO', 'PROLONGADA', 'PROLONGADO', 'RETARD',
  'MASTIGAVEL', 'EFERVESCENTE', 'DISPERSIVEL', 'SUBLINGUAL', 'NASAL', 'OFTALMICO', 'OFTALMICA', 'TOPICO',
  'VAGINAL', 'RETAL', 'SPRAY', 'AEROSSOL', 'INALATORIO', 'ESTERIL', 'PLASTICO', 'VIDRO', 'AMBAR', 'FRAC',
  'LABORATORIO', 'LTDA', 'FARMA', 'PHARMA', 'MEDICAMENTO', 'ACOND', 'CONCENTRADO', 'DILUICAO', 'PERFUSAO',
];

export type IndicePreBusca = {
  medicamentos: Map<string, MedicamentoDto>;
  // palavra-chave (forma canônica) -> códigos que a contêm
  palavras: Map<string, string[]>;
  // palavra com uma letra a menos -> palavras-chave de MIN_APROX+ letras que a geram
  delecoes: Map<string, string[]>;
  // palavras citadas em mais de dfMax itens: somam pontos, mas não trazem candidato sozinhas
  comuns: Set<string>;
  // itens sem nenhuma palavra-chave que traga candidato: a pré-busca nunca os acha
  semPalavra: number;
};

export type ResultadoPreBusca = { candidatos: MedicamentoDto[]; total: number; cortado: boolean };

// Trocas comuns do OCR (0/O, 1/I/l, 5/S, |): aplicadas igual na lista e no texto
export function canonOcr(token: string): string {
  return token.replace(/0/g, 'O').replace(/[1L]/g, 'I').replace(/5/g, 'S');
}

export function tokens(texto: string): string[] {
  return normalizar(texto)
    .replace(/\|/g, 'I')
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

const IGNORADAS = new Set(IGNORADAS_BASE.map(canonOcr));

function delecoesDe(palavra: string): string[] {
  const ret = new Set<string>();
  for (let i = 0; i < palavra.length; i++) {
    ret.add(palavra.slice(0, i) + palavra.slice(i + 1));
  }
  return [...ret];
}

function adicionar(mapa: Map<string, string[]>, chave: string, valor: string): void {
  const lista = mapa.get(chave);
  if (!lista) {
    mapa.set(chave, [valor]);
  } else if (lista[lista.length - 1] !== valor && !lista.includes(valor)) {
    lista.push(valor);
  }
}

// Palavras-chave de um medicamento: só letras, MIN_LETRAS+, fora das ignoradas, na forma canônica
function palavrasChave(m: MedicamentoDto): Set<string> {
  const ret = new Set<string>();
  for (const termo of [m.descricao, ...(m.termos ?? [])]) {
    for (const t of tokens(termo ?? '')) {
      if (t.length < MIN_LETRAS || !/^[A-Z]+$/.test(t)) continue;
      const c = canonOcr(t);
      if (!IGNORADAS.has(c)) ret.add(c);
    }
  }
  return ret;
}

export function montarIndice(medicamentos: MedicamentoDto[], dfMax: number): IndicePreBusca {
  const porCodigo = new Map<string, MedicamentoDto>();
  for (const m of medicamentos) {
    const codigo = m.codigo?.trim();
    if (codigo) porCodigo.set(codigo, m);
  }

  const palavras = new Map<string, string[]>();
  const chavesPorCodigo: Set<string>[] = [];
  for (const [codigo, m] of porCodigo) {
    const chaves = palavrasChave(m);
    chavesPorCodigo.push(chaves);
    for (const p of chaves) adicionar(palavras, p, codigo);
  }

  const delecoes = new Map<string, string[]>();
  const comuns = new Set<string>();
  for (const [p, codigos] of palavras) {
    if (codigos.length > dfMax) comuns.add(p);
    if (p.length >= MIN_APROX) {
      for (const d of delecoesDe(p)) adicionar(delecoes, d, p);
    }
  }
  // Item só com palavras comuns (ou nenhuma) nunca vira candidato
  const semPalavra = chavesPorCodigo.filter((chaves) => ![...chaves].some((p) => !comuns.has(p))).length;

  return { medicamentos: porCodigo, palavras, delecoes, comuns, semPalavra };
}

// Palavras-chave da lista com distância de edição 1 (no máximo) do token do texto
function aproximadas(indice: IndicePreBusca, t: string): string[] {
  if (t.length < MIN_APROX - 1) return [];
  const ret = new Set<string>(indice.delecoes.get(t) ?? []);
  for (const d of delecoesDe(t)) {
    for (const p of indice.delecoes.get(d) ?? []) ret.add(p);
    if (d.length >= MIN_APROX && indice.palavras.has(d)) ret.add(d);
  }
  return [...ret];
}

export function buscarCandidatos(indice: IndicePreBusca, texto: string, max: number): ResultadoPreBusca {
  // palavra-chave -> peso do melhor casamento (exato ou aproximado)
  const casadas = new Map<string, number>();
  for (const bruto of new Set(tokens(texto))) {
    if (bruto.length < MIN_LETRAS - 1) continue;
    const t = canonOcr(bruto);
    if (!/^[A-Z]+$/.test(t)) continue;
    if (indice.palavras.has(t)) {
      casadas.set(t, PESO_EXATO);
      continue;
    }
    for (const p of aproximadas(indice, t)) {
      if (!casadas.has(p)) casadas.set(p, PESO_APROX);
    }
  }

  const total = indice.medicamentos.size || 1;
  const pontos = new Map<string, number>();
  const ancorados = new Set<string>();
  for (const [p, peso] of casadas) {
    const codigos = indice.palavras.get(p) ?? [];
    const idf = Math.log(1 + total / codigos.length);
    for (const c of codigos) {
      pontos.set(c, (pontos.get(c) ?? 0) + peso * idf);
      if (!indice.comuns.has(p)) ancorados.add(c);
    }
  }

  const ordenados = [...ancorados].sort((a, b) => pontos.get(b)! - pontos.get(a)! || a.localeCompare(b));
  return {
    candidatos: ordenados.slice(0, max).map((c) => indice.medicamentos.get(c)!),
    total: ordenados.length,
    cortado: ordenados.length > max,
  };
}
