import { Inject, Injectable } from '@nestjs/common';
import { MOTOR_OCR, MotorOcr } from '../ocr/motor-ocr';
import { Extrator, TextoExtraido } from './extrator';

const EXTENSOES = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp']);

@Injectable()
export class ImagemExtrator implements Extrator {
  constructor(@Inject(MOTOR_OCR) private readonly ocr: MotorOcr) {}

  suporta(extensao: string): boolean {
    return EXTENSOES.has(extensao);
  }

  async extrair(arquivo: string): Promise<TextoExtraido> {
    return { texto: await this.ocr.lerImagem(arquivo), metodo: 'ocr-imagem' };
  }
}
