import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import SftpClient = require('ssh2-sftp-client');

@Injectable()
export class SftpService {
  private readonly logger = new Logger(SftpService.name);

  constructor(private readonly config: ConfigService) {}

  // Ambiente do Protheus igual a SFTP_AMBIENTE_PROD -> SFTP_PROD_*; qualquer outro -> SFTP_DEV_*
  perfil(ambiente: string): 'PROD' | 'DEV' {
    const ambProd = this.config.get<string>('SFTP_AMBIENTE_PROD', 'CYWSXT_PROD').trim().toUpperCase();
    return ambiente.trim().toUpperCase() === ambProd ? 'PROD' : 'DEV';
  }

  async baixar(arquivo: string, ambiente: string): Promise<Buffer> {
    const perfil = this.perfil(ambiente);
    const host = this.config.get<string>(`SFTP_${perfil}_HOST`);
    const username = this.config.get<string>(`SFTP_${perfil}_USER`);
    const password = this.config.get<string>(`SFTP_${perfil}_PASSWORD`);
    if (!host || !username || !password) {
      throw new Error(
        `SFTP ${perfil} não configurado (SFTP_${perfil}_HOST, SFTP_${perfil}_USER e SFTP_${perfil}_PASSWORD no .env)`,
      );
    }
    const port = Number(this.config.get(`SFTP_${perfil}_PORT`, '22'));
    const remoto = path.posix.join(this.config.get<string>('SFTP_DIR', '/'), arquivo);

    const sftp = new SftpClient();
    const inicio = Date.now();
    try {
      await sftp.connect({ host, port, username, password, readyTimeout: 20_000 });
      const tipo = await sftp.exists(remoto);
      if (tipo !== '-' && tipo !== 'l') {
        // "encontrado no SFTP" é o que o job Protheus usa para tratar o erro como definitivo
        throw new Error(`arquivo não encontrado no SFTP ${perfil}: ${remoto}`);
      }
      const conteudo = (await sftp.get(remoto)) as Buffer;
      this.logger.log(`Baixado ${remoto} de ${perfil} (${conteudo.length} bytes, ${Date.now() - inicio} ms)`);
      return conteudo;
    } finally {
      await sftp.end().catch(() => undefined);
    }
  }
}
