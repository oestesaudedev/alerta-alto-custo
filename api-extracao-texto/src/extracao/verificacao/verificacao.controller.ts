import { BadRequestException, Body, Controller, HttpCode, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTokenGuard } from '../../auth/api-token.guard';
import { VerificarDto, VerificarResult, VerificarSftpDto } from '../dto/verificar.dto';
import { extrairBase64Habilitado } from '../extracao.controller';
import { VerificacaoService } from './verificacao.service';

@Controller()
@UseGuards(ApiTokenGuard)
export class VerificacaoController {
  constructor(
    private readonly verificacao: VerificacaoService,
    private readonly config: ConfigService,
  ) {}

  // Só para testes: o job usa o /verificar-sftp
  @Post('verificar')
  @HttpCode(200)
  async verificar(@Body() body: VerificarDto): Promise<VerificarResult> {
    if (!extrairBase64Habilitado(this.config)) {
      throw new NotFoundException({ ok: false, erro: 'POST /verificar desabilitado (EXTRAIR_BASE64)' });
    }
    exigirLista(body);
    return this.verificacao.verificar(body.nome, body.conteudoBase64, body);
  }

  @Post('verificar-sftp')
  @HttpCode(200)
  async verificarSftp(@Body() body: VerificarSftpDto): Promise<VerificarResult> {
    exigirLista(body);
    return this.verificacao.verificarDoSftp(body.arquivo, body.ambiente, body);
  }
}

// Mesmo formato dos erros de validação (HTTP 400)
function exigirLista(body: { listaId?: string; medicamentos?: unknown[] }): void {
  if (!body.listaId && !body.medicamentos?.length) {
    throw new BadRequestException({ ok: false, erro: 'informe listaId ou medicamentos' });
  }
}
