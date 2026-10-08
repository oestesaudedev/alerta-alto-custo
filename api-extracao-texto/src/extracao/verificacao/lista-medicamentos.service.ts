import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { MedicamentoDto } from '../dto/extrair.dto';
import { IndicePreBusca, montarIndice } from './pre-busca';

const MAX_LISTAS = 3;
const VALIDADE_MS = 24 * 60 * 60 * 1000;

type ListaGuardada = { indice: IndicePreBusca; usadoEm: number };

export type ListaRegistrada = { listaId: string; itens: number; palavras: number; semPalavra: number };

// Listas de medicamentos enviadas pelo job (POST /medicamentos), uma vez por execução, com o índice da pré-busca.
// Ficam só em memória: depois de reiniciar a API, o /verificar-sftp responde "lista de medicamentos desconhecida"
// e o job reenvia.
@Injectable()
export class ListaMedicamentosService {
  private readonly logger = new Logger(ListaMedicamentosService.name);
  private readonly listas = new Map<string, ListaGuardada>();
  readonly dfMax: number;

  constructor(config: ConfigService) {
    this.dfMax = Number(config.get('PRE_BUSCA_DF_MAX', '500')) || 500;
  }

  // Mesma lista, mesmo id: reenviar não duplica nada
  registrar(medicamentos: MedicamentoDto[]): ListaRegistrada {
    const ordenada = [...medicamentos]
      .map((m) => ({ codigo: m.codigo.trim(), descricao: m.descricao ?? '', termos: m.termos ?? [] }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
    const listaId = createHash('sha256').update(JSON.stringify(ordenada)).digest('hex');

    let guardada = this.listas.get(listaId);
    if (!guardada) {
      const inicio = Date.now();
      guardada = { indice: montarIndice(ordenada, this.dfMax), usadoEm: Date.now() };
      this.listas.set(listaId, guardada);
      this.descartarSobras();
      const { indice } = guardada;
      this.logger.log(
        `Lista ${listaId.slice(0, 12)} registrada: ${indice.medicamentos.size} medicamento(s), ${indice.palavras.size} ` +
          `palavra(s)-chave, ${indice.semPalavra} sem palavra-chave, em ${Date.now() - inicio} ms`,
      );
    }
    guardada.usadoEm = Date.now();
    const { indice } = guardada;
    return { listaId, itens: indice.medicamentos.size, palavras: indice.palavras.size, semPalavra: indice.semPalavra };
  }

  obter(listaId: string): IndicePreBusca | undefined {
    const guardada = this.listas.get(listaId);
    if (!guardada) return undefined;
    if (Date.now() - guardada.usadoEm > VALIDADE_MS) {
      this.listas.delete(listaId);
      return undefined;
    }
    guardada.usadoEm = Date.now();
    return guardada.indice;
  }

  private descartarSobras(): void {
    const agora = Date.now();
    for (const [id, l] of this.listas) {
      if (agora - l.usadoEm > VALIDADE_MS) this.listas.delete(id);
    }
    while (this.listas.size > MAX_LISTAS) {
      const [maisAntiga] = [...this.listas.entries()].sort((a, b) => a[1].usadoEm - b[1].usadoEm)[0];
      this.listas.delete(maisAntiga);
    }
  }
}
