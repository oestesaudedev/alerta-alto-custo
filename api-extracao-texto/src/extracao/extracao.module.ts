import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExtracaoController } from './extracao.controller';
import { ExtracaoService } from './extracao.service';
import { EXTRATORES } from './extratores/extrator';
import { ImagemExtrator } from './extratores/imagem.extrator';
import { PdfExtrator } from './extratores/pdf.extrator';
import { IaService } from './ia/ia.service';
import { MODELO_IA } from './ia/modelo-ia';
import { criarModeloIa } from './ia/modelo-ia.factory';
import { LimitadorConcorrencia } from './limitador-concorrencia';
import { MOTOR_OCR } from './ocr/motor-ocr';
import { TesseractOcr } from './ocr/tesseract.ocr';
import { PastaTemporaria } from './pasta-temporaria';
import { SftpService } from './sftp.service';
import { VerificacaoController } from './verificacao/verificacao.controller';
import { VerificacaoService } from './verificacao/verificacao.service';
import { ApiTokenGuard } from '../auth/api-token.guard';

@Module({
  controllers: [ExtracaoController, VerificacaoController],
  providers: [
    ExtracaoService,
    VerificacaoService,
    SftpService,
    IaService,
    ApiTokenGuard,
    LimitadorConcorrencia,
    PastaTemporaria,
    PdfExtrator,
    ImagemExtrator,
    { provide: MOTOR_OCR, useClass: TesseractOcr },
    {
      provide: EXTRATORES,
      useFactory: (pdf: PdfExtrator, imagem: ImagemExtrator) => [pdf, imagem],
      inject: [PdfExtrator, ImagemExtrator],
    },
    { provide: MODELO_IA, useFactory: criarModeloIa, inject: [ConfigService] },
  ],
})
export class ExtracaoModule {}
