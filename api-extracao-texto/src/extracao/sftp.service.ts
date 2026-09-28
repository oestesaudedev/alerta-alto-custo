import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import SftpClient = require('ssh2-sftp-client');

@Injectable()
export class SftpService {
  private readonly logger = new Logger(SftpService.name);

  constructor(private readonly config: ConfigService) {}

  async baixar(arquivo: string): Promise<Buffer> {
    const host = this.config.get<string>('SFTP_HOST');
    const username = this.config.get<string>('SFTP_USER');
    const password = this.config.get<string>('SFTP_PASSWORD');
    if (!host || !username || !password) {
      throw new Error('SFTP não configurado (SFTP_HOST, SFTP_USER e SFTP_PASSWORD no .env)');
    }
    const port = Number(this.config.get('SFTP_PORT', '22'));
    const remoto = path.posix.join(this.config.get<string>('SFTP_DIR', '/'), arquivo);

    const sftp = new SftpClient();
    const inicio = Date.now();
    try {
      await sftp.connect({ host, port, username, password, readyTimeout: 20_000 });
      const tipo = await sftp.exists(remoto);
      if (tipo !== '-' && tipo !== 'l') {
        throw new Error(`arquivo não encontrado no SFTP: ${remoto}`);
      }
      const conteudo = (await sftp.get(remoto)) as Buffer;
      this.logger.log(`Baixado ${remoto} (${conteudo.length} bytes, ${Date.now() - inicio} ms)`);
      return conteudo;
    } finally {
      await sftp.end().catch(() => undefined);
    }
  }
}
