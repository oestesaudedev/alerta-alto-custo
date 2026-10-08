import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AchadoIa, ConfiancaIa, ContextoIa, MedicamentoDto, ResultadoIa } from '../dto/extrair.dto';
import { mascarar, palavrasProtegidas } from './mascara';
import { MODELO_IA, ModeloIa } from './modelo-ia';

const FERRAMENTA = 'registrar_medicamentos';
const TERMO_MAX = 60;
const MOTIVO_MAX = 120;
const CONFIANCAS: ConfiancaIa[] = ['alta', 'media', 'baixa'];
const CONTEXTOS: ContextoIa[] = ['solicitado', 'informativo', 'historico', 'outro'];

const INSTRUCOES = `Você apoia a auditoria médica de uma operadora de saúde.
Você recebe o texto extraído de um anexo de guia (pedido médico, relatório, receita, laudo, termo, folheto).
O texto pode vir de OCR, com letras trocadas, palavras quebradas e acentos perdidos.
Dados pessoais já foram mascarados como [NOME], [CPF], [CNS], [CARTEIRINHA], [TELEFONE], [EMAIL] e [DATA]; ignore esses marcadores.

Tarefa: registrar os medicamentos da LISTA citados no texto e, para cada um, o contexto da citação.
Só interessa o medicamento pedido de forma explícita para o tratamento atual do paciente.
- "contexto":
  - "solicitado": o texto pede, prescreve ou indica o medicamento para o paciente agora ("solicito", "prescrevo",
    "indico", receita com posologia, pedido de autorização do medicamento).
  - "informativo": o documento ou o trecho só informa sobre o medicamento: folheto, bula, termo de consentimento,
    orientação ao paciente, lista de reações adversas, riscos ou contraindicações. Se o documento inteiro for desse tipo,
    nenhum medicamento dele é "solicitado", mesmo que o nome apareça várias vezes.
  - "historico": medicamento que o paciente usa ou já usou, sem pedido no texto: "paciente em uso de", "faz uso de",
    "em uso contínuo", lista de medicações em uso, uso anterior, medicamento suspenso, falha terapêutica, alergia,
    contraindicação. Estar em uso não é pedido de cobertura: só vira "solicitado" se o texto também pedir, prescrever ou
    renovar o medicamento de forma explícita.
  - "outro": qualquer outra citação que não seja um pedido.
  - Na dúvida entre "solicitado" e outro contexto, não use "solicitado".
- Para identificar o medicamento, considere primeiro o nome mais próximo do exato existente na lista; caso não haja,
  considere nome genérico, princípio ativo, nome comercial (por exemplo, Remicade para infliximabe), abreviações usuais
  e grafias com erro de OCR.
- Use apenas códigos da LISTA. Não invente códigos nem inclua medicamentos fora dela.
- Um medicamento aparece no máximo uma vez; se for citado em mais de um contexto, use "solicitado" se algum trecho o pedir.
- "termo": a palavra ou expressão como aparece no texto (até ${TERMO_MAX} caracteres).
- "confianca": só a identificação do nome, não o contexto. "alta" quando o nome é inequívoco; "media" quando é provável
  (nome comercial ou erro de OCR plausível); "baixa" quando é duvidoso.
- "motivo": explicação curta, até ${MOTIVO_MAX} caracteres, sem nenhum dado do paciente (nome, data, documento, diagnóstico).
  Exemplos: "solicitado no relatório, nome exato da lista", "prescrito na receita, nome comercial de infliximabe",
  "folheto de reações adversas", "paciente em uso, sem pedido", "citado como uso anterior".
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
          contexto: {
            type: 'string',
            enum: CONTEXTOS,
            description: 'solicitado só quando o texto pede o medicamento para o paciente agora; "em uso" sem pedido é historico',
          },
          confianca: { type: 'string', enum: CONFIANCAS, description: 'Certeza da identificação do nome' },
          motivo: { type: 'string', description: 'Explicação curta, sem dados do paciente' },
        },
        required: ['codigo', 'termo', 'contexto', 'confianca', 'motivo'],
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
    const cortado = texto.length > this.maxChars;
    // Lista vazia (pré-busca sem candidato) ou texto vazio: nada a perguntar ao Claude
    if (!lista.length || !texto.trim()) {
      return { ok: true, modelo: this.modelo.nome, achados: [], ...(cortado && { cortado }) };
    }

    const protegidas = palavrasProtegidas(lista.flatMap((m) => [m.descricao, ...(m.termos ?? [])]));
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

      const { achados, naoSolicitados } = this.validar((resposta.dados as { achados?: unknown } | null)?.achados, lista);
      const { entrada, cache, saida } = resposta.tokens;
      this.logger.log(
        `IA ${resposta.modelo}: ${achados.length} achado(s), ${naoSolicitados} não solicitado(s) em ${Date.now() - inicio} ms ` +
          `(entrada ${entrada}, cache ${cache}, saída ${saida} tokens)`,
      );
      return { ok: true, modelo: resposta.modelo, achados, ...(cortado && { cortado }) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`IA falhou em ${Date.now() - inicio} ms: ${msg}`);
      return { ok: false, erro: limitar(msg, 300) };
    }
  }

  // Descarta códigos fora da lista e tudo que não for "solicitado" (folheto, histórico, contexto inválido);
  // dos solicitados, mantém um achado por código, o de maior confiança.
  private validar(bruto: unknown, lista: MedicamentoDto[]): { achados: AchadoIa[]; naoSolicitados: number } {
    const codigos = new Set(lista.map((m) => m.codigo.trim()));
    const porCodigo = new Map<string, AchadoIa>();
    const descartados = new Set<string>();
    for (const item of Array.isArray(bruto) ? bruto : []) {
      const a = (item ?? {}) as Record<string, unknown>;
      const codigo = limitar(a.codigo, 30);
      const confianca = String(a.confianca ?? '').toLowerCase() as ConfiancaIa;
      const contexto = String(a.contexto ?? '').toLowerCase() as ContextoIa;
      if (!codigos.has(codigo) || !CONFIANCAS.includes(confianca)) continue;
      if (contexto !== 'solicitado') {
        descartados.add(codigo);
        continue;
      }
      const achado: AchadoIa = {
        codigo,
        termo: limitar(a.termo, TERMO_MAX),
        contexto,
        confianca,
        motivo: limitar(a.motivo, MOTIVO_MAX),
      };
      const atual = porCodigo.get(codigo);
      if (!atual || CONFIANCAS.indexOf(confianca) < CONFIANCAS.indexOf(atual.confianca)) {
        porCodigo.set(codigo, achado);
      }
    }
    const naoSolicitados = [...descartados].filter((c) => !porCodigo.has(c)).length;
    return { achados: [...porCodigo.values()], naoSolicitados };
  }
}
