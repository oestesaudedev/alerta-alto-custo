import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTokenGuard } from '../auth/api-token.guard';
import { ExtrairDto, ExtrairResult, ExtrairSftpDto } from './dto/extrair.dto';
import { ExtracaoService } from './extracao.service';

@Controller()
@UseGuards(ApiTokenGuard)
export class ExtracaoController {
  constructor(private readonly extracao: ExtracaoService) {}

  @Post('extrair')
  @HttpCode(200)
  async extrair(@Body() body: ExtrairDto): Promise<ExtrairResult> {
    return this.extracao.extrair(body.nome, body.conteudoBase64);
  }

  @Post('extrair-sftp')
  @HttpCode(200)
  async extrairSftp(@Body() body: ExtrairSftpDto): Promise<ExtrairResult> {
    return this.extracao.extrairDoSftp(body.arquivo, body.ambiente);
  }
}
