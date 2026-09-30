import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';

function hash(valor: string): Buffer {
  return createHash('sha256').update(valor).digest();
}

@Injectable()
export class ApiTokenGuard implements CanActivate {
  // API_TOKEN obrigatório e forte: validado na subida por validarEnv
  private readonly esperado: Buffer;

  constructor(config: ConfigService) {
    this.esperado = hash(config.getOrThrow<string>('API_TOKEN').trim());
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const token = header.replace(/^Bearer\s+/i, '').trim();

    if (!token || !timingSafeEqual(hash(token), this.esperado)) {
      throw new UnauthorizedException({
        ok: false,
        erro: 'Token Authorization inválido ou ausente',
      });
    }
    return true;
  }
}
