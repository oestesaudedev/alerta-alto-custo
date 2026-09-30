// Porta para o provedor de IA: extração estruturada (JSON no formato de `saida.esquema`) a partir de um texto.
// Provedor novo: nova classe que implementa ModeloIa, escolhida por IA_PROVEDOR em criarModeloIa.
export type PedidoExtracao = {
  instrucoes: string;
  // Parte estável entre chamadas (a lista de medicamentos): o provedor pode fazer cache dela
  contexto: string;
  texto: string;
  saida: { nome: string; descricao: string; esquema: Record<string, unknown> };
};

export type RespostaExtracao = {
  modelo: string;
  dados: unknown;
  tokens: { entrada: number; cache: number; saida: number };
};

export interface ModeloIa {
  readonly nome: string;
  // Lança em qualquer falha (rede, timeout, resposta fora do formato)
  extrair(pedido: PedidoExtracao): Promise<RespostaExtracao>;
}

export const MODELO_IA = Symbol('MODELO_IA');
