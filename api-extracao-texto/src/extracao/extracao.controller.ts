import { Body, Controller, HttpCode, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTokenGuard } from '../auth/api-token.guard';
import { ExtrairDto, ExtrairResult, ExtrairSftpDto } from './dto/extrair.dto';
import { ExtracaoService } from './extracao.service';

export function extrairBase64Habilitado(config: ConfigService): boolean {
  return String(config.get('EXTRAIR_BASE64', 'false')).trim().toLowerCase() === 'true';
}

@Controller()
@UseGuards(ApiTokenGuard)
export class ExtracaoController {
  constructor(
    private readonly extracao: ExtracaoService,
    private readonly config: ConfigService,
  ) {}

  // Só para testes: o job usa o /extrair-sftp
  @Post('extrair')
  @HttpCode(200)
  async extrair(@Body() body: ExtrairDto): Promise<ExtrairResult> {
    if (!extrairBase64Habilitado(this.config)) {
      throw new NotFoundException({ ok: false, erro: 'POST /extrair desabilitado (EXTRAIR_BASE64)' });
    }
    return this.extracao.extrair(body.nome, body.conteudoBase64, body.medicamentos, body.mascarar);
  }

  @Post('extrair-sftp')
  @HttpCode(200)
  async extrairSftp(@Body() body: ExtrairSftpDto): Promise<ExtrairResult> {
    return this.extracao.extrairDoSftp(body.arquivo, body.ambiente, body.medicamentos, body.mascarar);
  }
}
