import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const FILA_MAX = 20;

export class FilaCheiaError extends Error {}

// pdftoppm/tesseract usam muita CPU e memória: poucas extrações por vez, o resto espera numa fila
@Injectable()
export class LimitadorConcorrencia {
  private readonly logger = new Logger(LimitadorConcorrencia.name);
  private readonly maximo: number;
  private emExecucao = 0;
  private readonly fila: Array<() => void> = [];

  constructor(config: ConfigService) {
    this.maximo = Math.max(1, Number(config.get('EXTRACAO_CONCORRENCIA', '2')) || 2);
  }

  // Lança FilaCheiaError quando já há FILA_MAX tarefas esperando
  async executar<T>(tarefa: () => Promise<T>): Promise<T> {
    if (this.emExecucao >= this.maximo) {
      if (this.fila.length >= FILA_MAX) {
        this.logger.warn(`Fila cheia (${FILA_MAX}): requisição recusada`);
        throw new FilaCheiaError(`fila cheia (${FILA_MAX})`);
      }
      await new Promise<void>((liberar) => this.fila.push(liberar));
    } else {
      this.emExecucao++;
    }
    try {
      return await tarefa();
    } finally {
      const proxima = this.fila.shift();
      if (proxima) {
        proxima();
      } else {
        this.emExecucao--;
      }
    }
  }
}
