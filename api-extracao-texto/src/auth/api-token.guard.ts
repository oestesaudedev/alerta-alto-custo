import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('API_TOKEN', 'dev-change-me');
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const token = header.replace(/^Bearer\s+/i, '').trim();

    if (!token || token !== expected) {
      throw new UnauthorizedException({
        ok: false,
        erro: 'Token Authorization inválido ou ausente',
      });
    }
    return true;
  }
}
