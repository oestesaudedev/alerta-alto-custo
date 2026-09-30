import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { MotorOcr } from './motor-ocr';

const execFileAsync = promisify(execFile);

@Injectable()
export class TesseractOcr implements MotorOcr {
  async lerImagem(caminho: string): Promise<string> {
    const { stdout } = await execFileAsync('tesseract', [caminho, 'stdout', '-l', 'por'], {
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return (stdout ?? '').trim();
  }
}
