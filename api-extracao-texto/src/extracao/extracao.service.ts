import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import pdfParse = require('pdf-parse');
import { ExtrairResult, MetodoExtracao } from './dto/extrair.dto';
import { SftpService } from './sftp.service';

const execFileAsync = promisify(execFile);

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp']);

function extensaoSuportada(ext: string): boolean {
  return ext === '.pdf' || IMAGE_EXTS.has(ext);
}

function erroExtensao(ext: string): ExtrairResult {
  return { ok: false, erro: `extensão não suportada: ${ext || '(sem extensão)'}` };
}

@Injectable()
export class ExtracaoService {
  private readonly logger = new Logger(ExtracaoService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly sftp: SftpService,
  ) {}

  async extrair(nome: string, conteudoBase64: string): Promise<ExtrairResult> {
    let buffer: Buffer;
    try {
      const raw = conteudoBase64.replace(/^data:[^;]+;base64,/, '');
      buffer = Buffer.from(raw, 'base64');
      if (!buffer.length) {
        return { ok: false, erro: 'conteudoBase64 vazio ou inválido' };
      }
    } catch {
      return { ok: false, erro: 'conteudoBase64 inválido' };
    }
    return this.extrairConteudo(nome, buffer);
  }

  async extrairDoSftp(arquivo: string, ambiente: string): Promise<ExtrairResult> {
    const nome = arquivo.trim();
    if (!nome || /[\\/]/.test(nome) || nome === '.' || nome === '..') {
      return { ok: false, erro: 'nome de arquivo inválido' };
    }
    const ext = path.extname(nome).toLowerCase();
    if (!extensaoSuportada(ext)) {
      return erroExtensao(ext);
    }

    let buffer: Buffer;
    try {
      buffer = await this.sftp.baixar(nome, ambiente);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha no SFTP ${this.sftp.perfil(ambiente)} (${nome}): ${msg}`);
      return { ok: false, erro: msg };
    }
    return this.extrairConteudo(nome, buffer);
  }

  private async extrairConteudo(nome: string, buffer: Buffer): Promise<ExtrairResult> {
    const safeName = path.basename(nome).replace(/[^\w.\-()+ ]/g, '_');
    if (!safeName) {
      return { ok: false, erro: 'nome de arquivo inválido' };
    }

    const workDir = await this.ensureTmpDir();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sessionDir = path.join(workDir, stamp);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, safeName);

    try {
      await fs.writeFile(filePath, buffer);
      const ext = path.extname(safeName).toLowerCase();

      if (ext === '.pdf') {
        return { ok: true, ...(await this.extrairPdf(filePath, sessionDir)) };
      }
      if (IMAGE_EXTS.has(ext)) {
        return { ok: true, texto: await this.ocrImagem(filePath), metodo: 'ocr-imagem' };
      }
      return erroExtensao(ext);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao extrair ${safeName}: ${msg}`);
      return { ok: false, erro: msg };
    } finally {
      await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async extrairPdf(
    pdfPath: string,
    sessionDir: string,
  ): Promise<{ texto: string; metodo: MetodoExtracao }> {
    const minChars = Number(this.config.get('PDF_MIN_TEXT_CHARS', '40'));
    let texto = '';
    try {
      // Precisa ser Uint8Array puro: o worker do pdf.js clona via
      // `new value.constructor(value)`, o que para Buffer < 4KB devolve uma fatia
      // do pool do Node, e depois lê o ArrayBuffer inteiro ignorando o byteOffset.
      const data = new Uint8Array(await fs.readFile(pdfPath));
      texto = ((await pdfParse(data as unknown as Buffer)).text ?? '').trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`pdf-parse falhou (${msg}) — tentando OCR via pdftoppm`);
      return { texto: await this.ocrPdfEscaneado(pdfPath, sessionDir), metodo: 'ocr-pdf' };
    }

    if (texto.length >= minChars) {
      return { texto, metodo: 'pdf-parse' };
    }

    this.logger.log(
      `PDF com pouco texto (${texto.length} chars) — OCR via pdftoppm`,
    );
    return { texto: await this.ocrPdfEscaneado(pdfPath, sessionDir), metodo: 'ocr-pdf' };
  }

  private async ocrPdfEscaneado(
    pdfPath: string,
    sessionDir: string,
  ): Promise<string> {
    // Limite de páginas: o job Protheus espera no máximo __API_TIMEOUT por anexo, e um timeout
    // lá é tratado como falha temporária, que prenderia o job nessa B71 a cada execução.
    const maxPaginas = Math.max(1, Number(this.config.get('PDF_MAX_PAGINAS', '30')) || 30);
    const total = await this.contarPaginas(pdfPath);
    if (total > maxPaginas) {
      this.logger.warn(
        `PDF com ${total} páginas — OCR só das ${maxPaginas} primeiras (PDF_MAX_PAGINAS)`,
      );
    }

    const prefix = path.join(sessionDir, 'page');
    await execFileAsync('pdftoppm', ['-png', '-f', '1', '-l', String(maxPaginas), pdfPath, prefix], {
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
    });

    const files = (await fs.readdir(sessionDir))
      .filter((f) => /^page-\d+\.png$/i.test(f) || /^page\d+\.png$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (!files.length) {
      throw new Error('pdftoppm não gerou páginas PNG');
    }

    const partes: string[] = [];
    for (const file of files) {
      partes.push(await this.ocrImagem(path.join(sessionDir, file)));
    }
    return partes.join('\n\n').trim();
  }

  // 0 quando o pdfinfo não consegue ler o PDF; nesse caso só vale o limite do pdftoppm
  private async contarPaginas(pdfPath: string): Promise<number> {
    try {
      const { stdout } = await execFileAsync('pdfinfo', [pdfPath], { timeout: 30_000 });
      const m = /^Pages:\s+(\d+)/m.exec(stdout ?? '');
      return m ? Number(m[1]) : 0;
    } catch {
      return 0;
    }
  }

  private async ocrImagem(imagePath: string): Promise<string> {
    const { stdout } = await execFileAsync(
      'tesseract',
      [imagePath, 'stdout', '-l', 'por'],
      {
        timeout: 120_000,
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    return (stdout ?? '').trim();
  }

  private async ensureTmpDir(): Promise<string> {
    const configured = this.config.get<string>('OCR_TMP_DIR');
    const dir =
      configured && configured.trim()
        ? path.resolve(configured)
        : path.join(os.tmpdir(), 'ocr-extracao');
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }
}
