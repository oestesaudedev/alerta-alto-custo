import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiTokenGuard } from '../../auth/api-token.guard';
import { MODELO_IA, ModeloIa } from '../ia/modelo-ia';

export type ConfigResult = { ok: true; ia: boolean; modelo?: string };

// Lido pelo job uma vez por execução: com ia=false ele não envia os anexos e alerta só pelos procedimentos da guia
@Controller('config')
@UseGuards(ApiTokenGuard)
export class ConfigController {
  constructor(@Inject(MODELO_IA) private readonly modelo: ModeloIa | null) {}

  @Get()
  config(): ConfigResult {
    return this.modelo ? { ok: true, ia: true, modelo: this.modelo.nome } : { ok: true, ia: false };
  }
}
