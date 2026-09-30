import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

// Os anexos têm dados de saúde: cada requisição usa uma pasta própria, sempre apagada ao final
@Injectable()
export class PastaTemporaria implements OnModuleInit {
  private readonly logger = new Logger(PastaTemporaria.name);
  private readonly raiz: string;

  constructor(config: ConfigService) {
    const configurada = String(config.get('OCR_TMP_DIR') ?? '').trim();
    this.raiz = configurada ? path.resolve(configurada) : path.join(os.tmpdir(), 'ocr-extracao');
  }

  // Sobras de uma execução interrompida
  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.raiz, { recursive: true });
    const itens = await fs.readdir(this.raiz);
    await Promise.all(
      itens.map((item) => fs.rm(path.join(this.raiz, item), { recursive: true, force: true }).catch(() => undefined)),
    );
    if (itens.length) {
      this.logger.warn(`${itens.length} temporário(s) de execução anterior apagado(s) em ${this.raiz}`);
    }
  }

  async comSessao<T>(uso: (pasta: string) => Promise<T>): Promise<T> {
    await fs.mkdir(this.raiz, { recursive: true });
    const pasta = path.join(this.raiz, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(pasta, { recursive: true });
    try {
      return await uso(pasta);
    } finally {
      await fs.rm(pasta, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
