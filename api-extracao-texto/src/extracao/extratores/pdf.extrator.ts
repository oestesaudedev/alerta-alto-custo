import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import pdfParse = require('pdf-parse');
import { MOTOR_OCR, MotorOcr } from '../ocr/motor-ocr';
import { Extrator, TextoExtraido } from './extrator';

const execFileAsync = promisify(execFile);

// PDF com camada de texto via pdf-parse; escaneado (ou que o pdf.js não abre) via pdftoppm + OCR
@Injectable()
export class PdfExtrator implements Extrator {
  private readonly logger = new Logger(PdfExtrator.name);
  private readonly minChars: number;
  private readonly maxPaginas: number;

  constructor(
    config: ConfigService,
    @Inject(MOTOR_OCR) private readonly ocr: MotorOcr,
  ) {
    this.minChars = Number(config.get('PDF_MIN_TEXT_CHARS', '40'));
    this.maxPaginas = Math.max(1, Number(config.get('PDF_MAX_PAGINAS', '30')) || 30);
  }

  suporta(extensao: string): boolean {
    return extensao === '.pdf';
  }

  async extrair(arquivo: string, pastaSessao: string): Promise<TextoExtraido> {
    let texto = '';
    try {
      // Precisa ser Uint8Array puro: o worker do pdf.js clona via
      // `new value.constructor(value)`, o que para Buffer < 4KB devolve uma fatia
      // do pool do Node, e depois lê o ArrayBuffer inteiro ignorando o byteOffset.
      const data = new Uint8Array(await fs.readFile(arquivo));
      texto = ((await pdfParse(data as unknown as Buffer)).text ?? '').trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`pdf-parse falhou (${msg}) — tentando OCR via pdftoppm`);
      return { texto: await this.ocrEscaneado(arquivo, pastaSessao), metodo: 'ocr-pdf' };
    }

    if (texto.length >= this.minChars) {
      return { texto, metodo: 'pdf-parse' };
    }

    this.logger.log(`PDF com pouco texto (${texto.length} chars) — OCR via pdftoppm`);
    return { texto: await this.ocrEscaneado(arquivo, pastaSessao), metodo: 'ocr-pdf' };
  }

  private async ocrEscaneado(arquivo: string, pastaSessao: string): Promise<string> {
    // Limite de páginas: o job Protheus espera no máximo __API_TIMEOUT por anexo, e um timeout
    // lá é tratado como falha temporária, que prenderia o job nessa B71 a cada execução.
    const total = await this.contarPaginas(arquivo);
    if (total > this.maxPaginas) {
      this.logger.warn(`PDF com ${total} páginas — OCR só das ${this.maxPaginas} primeiras (PDF_MAX_PAGINAS)`);
    }

    const prefixo = path.join(pastaSessao, 'page');
    await execFileAsync('pdftoppm', ['-png', '-f', '1', '-l', String(this.maxPaginas), arquivo, prefixo], {
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
    });

    const paginas = (await fs.readdir(pastaSessao))
      .filter((f) => /^page-\d+\.png$/i.test(f) || /^page\d+\.png$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (!paginas.length) {
      throw new Error('pdftoppm não gerou páginas PNG');
    }

    const partes: string[] = [];
    for (const pagina of paginas) {
      partes.push(await this.ocr.lerImagem(path.join(pastaSessao, pagina)));
    }
    return partes.join('\n\n').trim();
  }

  // 0 quando o pdfinfo não consegue ler o PDF; nesse caso só vale o limite do pdftoppm
  private async contarPaginas(arquivo: string): Promise<number> {
    try {
      const { stdout } = await execFileAsync('pdfinfo', [arquivo], { timeout: 30_000 });
      const m = /^Pages:\s+(\d+)/m.exec(stdout ?? '');
      return m ? Number(m[1]) : 0;
    } catch {
      return 0;
    }
  }
}
