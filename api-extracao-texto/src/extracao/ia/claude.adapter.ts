import Anthropic from '@anthropic-ai/sdk';
import { ConfigService } from '@nestjs/config';
import { ModeloIa, PedidoExtracao, RespostaExtracao } from './modelo-ia';

const MODELO_PADRAO = 'claude-sonnet-5-5';

// Extração estruturada via tool use forçado; o contexto vai num bloco de system com prompt caching
export class ClaudeAdapter implements ModeloIa {
  readonly nome: string;
  private readonly timeoutMs: number;
  private readonly cliente: Anthropic;

  constructor(config: ConfigService) {
    this.nome = String(config.get('IA_MODELO') || MODELO_PADRAO).trim();
    this.timeoutMs = Number(config.get('IA_TIMEOUT_MS', '60000')) || 60000;
    this.cliente = new Anthropic({
      apiKey: String(config.get('ANTHROPIC_API_KEY') ?? '').trim(),
      timeout: this.timeoutMs,
      maxRetries: 1,
    });
  }

  async extrair(pedido: PedidoExtracao): Promise<RespostaExtracao> {
    const { nome, descricao, esquema } = pedido.saida;
    const resposta = await this.cliente.messages.create(
      {
        model: this.nome,
        max_tokens: 2048,
        system: [
          { type: 'text', text: pedido.instrucoes },
          { type: 'text', text: pedido.contexto, cache_control: { type: 'ephemeral' } },
        ],
        tools: [{ name: nome, description: descricao, input_schema: esquema as Anthropic.Tool.InputSchema }],
        tool_choice: { type: 'tool', name: nome },
        messages: [{ role: 'user', content: pedido.texto }],
      },
      { signal: AbortSignal.timeout(this.timeoutMs) },
    );

    const bloco = resposta.content.find((c) => c.type === 'tool_use' && c.name === nome);
    if (!bloco || bloco.type !== 'tool_use') {
      throw new Error(`resposta da IA sem a ferramenta ${nome} (stop_reason ${resposta.stop_reason})`);
    }

    const uso = resposta.usage;
    return {
      modelo: resposta.model,
      dados: bloco.input,
      tokens: { entrada: uso.input_tokens, cache: uso.cache_read_input_tokens ?? 0, saida: uso.output_tokens },
    };
  }
}
