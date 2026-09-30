import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import * as path from 'path';
import SftpClient = require('ssh2-sftp-client');
import { hostKeys } from '../config/validar-env';

// Mesmo formato do `ssh-keygen -lf`: SHA256 da chave pública em Base64, sem "="
function fingerprint(chave: Buffer): string {
  return `SHA256:${createHash('sha256').update(chave).digest('base64').replace(/=+$/, '')}`;
}

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
    const aceitas = hostKeys(this.config.get<string>(`SFTP_${perfil}_HOSTKEY`));
    let recebida = '';

    const sftp = new SftpClient();
    const inicio = Date.now();
    try {
      try {
        await sftp.connect({
          host,
          port,
          username,
          password,
          readyTimeout: 20_000,
          hostVerifier: (chave: Buffer) => {
            recebida = fingerprint(chave);
            return aceitas.includes(recebida);
          },
        });
      } catch (err) {
        if (recebida && !aceitas.includes(recebida)) {
          throw new Error(
            `chave do servidor SFTP ${perfil} não confere (${recebida}); confira SFTP_${perfil}_HOSTKEY`,
          );
        }
        throw err;
      }
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
