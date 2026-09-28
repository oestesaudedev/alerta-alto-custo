import { Controller, Get } from '@nestjs/common';

// Sem ApiTokenGuard: usado pelo HEALTHCHECK do Docker e por monitoramento.
@Controller('health')
export class HealthController {
  @Get()
  health(): { ok: true } {
    return { ok: true };
  }
}
