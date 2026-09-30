import { MetodoExtracao } from '../dto/extrair.dto';

export type TextoExtraido = { texto: string; metodo: MetodoExtracao };

// Um formato de anexo. Formato novo: nova classe que implementa Extrator, registrada em EXTRATORES
export interface Extrator {
  suporta(extensao: string): boolean;
  // `pastaSessao`: pasta temporária exclusiva da requisição, apagada ao final
  extrair(arquivo: string, pastaSessao: string): Promise<TextoExtraido>;
}

export const EXTRATORES = Symbol('EXTRATORES');
