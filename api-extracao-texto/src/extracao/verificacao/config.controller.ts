import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTokenGuard } from '../../auth/api-token.guard';
import { CriterioMedicamento, criterioMedicamento } from '../../config/validar-env';
import { MODELO_IA, ModeloIa } from '../ia/modelo-ia';

export type ConfigResult = {
  ok: true;
  ia: boolean;
  modelo?: string;
  criterio: CriterioMedicamento;
  valorMin?: number;
};

// Lido pelo job uma vez por execução: com ia=false ele não envia os anexos e alerta só pelos procedimentos da guia;
// criterio/valorMin definem quais medicamentos da BR8 entram na lista (validados na subida por validarEnv)
@Controller('config')
@UseGuards(ApiTokenGuard)
export class ConfigController {
  constructor(
    @Inject(MODELO_IA) private readonly modelo: ModeloIa | null,
    private readonly env: ConfigService,
  ) {}

  @Get()
  config(): ConfigResult {
    const criterio = criterioMedicamento(this.env.get('MEDICAMENTO_CRITERIO')) as CriterioMedicamento;
    return {
      ok: true,
      ia: !!this.modelo,
      ...(this.modelo ? { modelo: this.modelo.nome } : {}),
      criterio,
      ...(criterio === 'valor' ? { valorMin: Number(this.env.get('MEDICAMENTO_VALOR_MIN')) } : {}),
    };
  }
}
