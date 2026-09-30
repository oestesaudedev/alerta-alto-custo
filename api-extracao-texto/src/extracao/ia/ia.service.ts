import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AchadoIa, ConfiancaIa, MedicamentoDto, ResultadoIa } from '../dto/extrair.dto';
import { mascarar, palavrasProtegidas } from './mascara';
import { MODELO_IA, ModeloIa } from './modelo-ia';

const FERRAMENTA = 'registrar_medicamentos';
const TERMO_MAX = 60;
const MOTIVO_MAX = 120;
const CONFIANCAS: ConfiancaIa[] = ['alta', 'media', 'baixa'];

const INSTRUCOES = `Você apoia a auditoria médica de uma operadora de saúde.
Você recebe o texto extraído de um anexo de guia (pedido médico, relatório, receita, laudo). O texto pode vir de OCR, com letras trocadas, palavras quebradas e acentos perdidos. Dados pessoais já foram mascarados como [NOME], [CPF], [CNS], [CARTEIRINHA], [TELEFONE], [EMAIL] e [DATA]; ignore esses marcadores.

Tarefa: dizer quais medicamentos da LISTA abaixo são citados no texto.
- Considere nome genérico, princípio ativo, nome comercial (por exemplo, Remicade para infliximabe), abreviações usuais e grafias com erro de OCR.
- Inclua também os medicamentos escritos exatamente como na lista.
- Inclua o medicamento mesmo quando citado como negado, suspenso ou histórico, e diga isso no motivo.
- Use apenas códigos da LISTA. Não invente códigos nem inclua medicamentos fora dela.
- Um medicamento aparece no máximo uma vez.
- "termo": a palavra ou expressão como aparece no texto (até ${TERMO_MAX} caracteres).
- "confianca": "alta" quando a citação é inequívoca; "media" quando é provável (nome comercial ou erro de OCR plausível); "baixa" quando é duvidosa.
- "motivo": explicação curta, até ${MOTIVO_MAX} caracteres, sem nenhum dado do paciente (nome, data, documento, diagnóstico). Exemplos: "nome exato da lista", "nome comercial de infliximabe", "grafia com erro de OCR", "citado como medicamento suspenso".
- Se nenhum medicamento da lista for citado, devolva a lista de achados vazia.
Responda sempre chamando a ferramenta ${FERRAMENTA}.`;

const ESQUEMA = {
  type: 'object',
  properties: {
    achados: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          codigo: { type: 'string', description: 'Código do medicamento, exatamente como na LISTA' },
          termo: { type: 'string', description: 'Palavra ou expressão como aparece no texto' },
          confianca: { type: 'string', enum: CONFIANCAS },
          motivo: { type: 'string', description: 'Explicação curta, sem dados do paciente' },
        },
        required: ['codigo', 'termo', 'confianca', 'motivo'],
      },
    },
  },
  required: ['achados'],
};

function limitar(valor: unknown, max: number): string {
  return String(valor ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function montarLista(medicamentos: MedicamentoDto[]): string {
  return medicamentos
    .map((m) => {
      const termos = [...new Set((m.termos ?? []).map((t) => t.trim()).filter(Boolean))];
      return `${m.codigo.trim()} | ${m.descricao.trim()}${termos.length ? ` | ${termos.join('; ')}` : ''}`;
    })
    .join('\n');
}

// Regras do domínio (prompt, mascaramento, validação); a chamada ao provedor fica no ModeloIa
@Injectable()
export class IaService {
  private readonly logger = new Logger(IaService.name);
  private readonly maxChars: number;

  constructor(
    config: ConfigService,
    @Inject(MODELO_IA) private readonly modelo: ModeloIa | null,
  ) {
    this.maxChars = Number(config.get('IA_MAX_CHARS', '100000')) || 100000;
  }

  // Nunca lança: qualquer falha volta como { ok: false } e quem chamou decide (o /verificar* devolve erro).
  async analisar(texto: string, medicamentos: MedicamentoDto[], conhecidos: string[] = []): Promise<ResultadoIa> {
    if (!this.modelo) {
      return { ok: false, erro: 'IA desabilitada (IA_HABILITADA)' };
    }
    const lista = medicamentos.filter((m) => m.codigo?.trim());
    if (!lista.length || !texto.trim()) {
      return { ok: true, modelo: this.modelo.nome, achados: [] };
    }

    const protegidas = palavrasProtegidas(lista.flatMap((m) => [m.descricao, ...(m.termos ?? [])]));
    const cortado = texto.length > this.maxChars;
    if (cortado) {
      this.logger.warn(`Texto com ${texto.length} caracteres: a IA lê só os primeiros ${this.maxChars} (IA_MAX_CHARS)`);
    }
    const textoIa = mascarar(texto.slice(0, this.maxChars), conhecidos, protegidas);
    const inicio = Date.now();
    try {
      const resposta = await this.modelo.extrair({
        instrucoes: INSTRUCOES,
        contexto: `LISTA (código | descrição | outros termos):\n${montarLista(lista)}`,
        texto: `TEXTO DO ANEXO:\n${textoIa}`,
        saida: { nome: FERRAMENTA, descricao: 'Registra os medicamentos da LISTA citados no texto', esquema: ESQUEMA },
      });

      const achados = this.validar((resposta.dados as { achados?: unknown } | null)?.achados, lista);
      const { entrada, cache, saida } = resposta.tokens;
      this.logger.log(
        `IA ${resposta.modelo}: ${achados.length} achado(s) em ${Date.now() - inicio} ms ` +
          `(entrada ${entrada}, cache ${cache}, saída ${saida} tokens)`,
      );
      return { ok: true, modelo: resposta.modelo, achados, ...(cortado && { cortado }) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`IA falhou em ${Date.now() - inicio} ms: ${msg}`);
      return { ok: false, erro: limitar(msg, 300) };
    }
  }

  // Descarta códigos fora da lista e mantém um achado por código, o de maior confiança.
  private validar(bruto: unknown, lista: MedicamentoDto[]): AchadoIa[] {
    const codigos = new Set(lista.map((m) => m.codigo.trim()));
    const porCodigo = new Map<string, AchadoIa>();
    for (const item of Array.isArray(bruto) ? bruto : []) {
      const a = (item ?? {}) as Record<string, unknown>;
      const codigo = limitar(a.codigo, 30);
      const confianca = String(a.confianca ?? '').toLowerCase() as ConfiancaIa;
      if (!codigos.has(codigo) || !CONFIANCAS.includes(confianca)) continue;
      const achado: AchadoIa = {
        codigo,
        termo: limitar(a.termo, TERMO_MAX),
        confianca,
        motivo: limitar(a.motivo, MOTIVO_MAX),
      };
      const atual = porCodigo.get(codigo);
      if (!atual || CONFIANCAS.indexOf(confianca) < CONFIANCAS.indexOf(atual.confianca)) {
        porCodigo.set(codigo, achado);
      }
    }
    return [...porCodigo.values()];
  }
}
