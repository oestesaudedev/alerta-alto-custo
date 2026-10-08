import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTokenGuard } from '../../auth/api-token.guard';
import { RegistrarListaDto } from '../dto/verificar.dto';
import { ListaMedicamentosService, ListaRegistrada } from './lista-medicamentos.service';

// Chamado pelo job uma vez por execução: a lista completa fica na API e o /verificar-sftp recebe só o listaId
@Controller('medicamentos')
@UseGuards(ApiTokenGuard)
export class MedicamentosController {
  constructor(private readonly listas: ListaMedicamentosService) {}

  @Post()
  @HttpCode(200)
  registrar(@Body() body: RegistrarListaDto): { ok: true } & ListaRegistrada {
    return { ok: true, ...this.listas.registrar(body.medicamentos) };
  }
}
