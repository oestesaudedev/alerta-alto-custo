import { Inject, Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { ExtrairResult, MedicamentoDto } from './dto/extrair.dto';
import { EXTRATORES, Extrator } from './extratores/extrator';
import { IaService } from './ia/ia.service';
import { FilaCheiaError, LimitadorConcorrencia } from './limitador-concorrencia';
import { PastaTemporaria } from './pasta-temporaria';
import { SftpService } from './sftp.service';

function erroExtensao(ext: string): ExtrairResult {
  return { ok: false, erro: `extensão não suportada: ${ext || '(sem extensão)'}` };
}

@Injectable()
export class ExtracaoService {
  private readonly logger = new Logger(ExtracaoService.name);

  constructor(
    private readonly sftp: SftpService,
    private readonly ia: IaService,
    private readonly limitador: LimitadorConcorrencia,
    private readonly pastas: PastaTemporaria,
    @Inject(EXTRATORES) private readonly extratores: Extrator[],
  ) {}

  async extrair(
    nome: string,
    conteudoBase64: string,
    medicamentos?: MedicamentoDto[],
    mascarar?: string[],
  ): Promise<ExtrairResult> {
    return this.comIa(await this.comLimite(() => this.extrairBase64(nome, conteudoBase64)), medicamentos, mascarar);
  }

  async extrairDoSftp(
    arquivo: string,
    ambiente: string,
    medicamentos?: MedicamentoDto[],
    mascarar?: string[],
  ): Promise<ExtrairResult> {
    return this.comIa(await this.comLimite(() => this.baixarEExtrair(arquivo, ambiente)), medicamentos, mascarar);
  }

  private async comLimite(tarefa: () => Promise<ExtrairResult>): Promise<ExtrairResult> {
    try {
      return await this.limitador.executar(tarefa);
    } catch (err) {
      if (err instanceof FilaCheiaError) {
        return { ok: false, erro: 'API ocupada, tente novamente' };
      }
      throw err;
    }
  }

  // A IA roda fora do limitador, que protege só a CPU do OCR
  private async comIa(resultado: ExtrairResult, medicamentos?: MedicamentoDto[], mascarar?: string[]): Promise<ExtrairResult> {
    if (!resultado.ok || !medicamentos?.length) {
      return resultado;
    }
    return { ...resultado, ia: await this.ia.analisar(resultado.texto, medicamentos, mascarar ?? []) };
  }

  private async extrairBase64(nome: string, conteudoBase64: string): Promise<ExtrairResult> {
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

  private async baixarEExtrair(arquivo: string, ambiente: string): Promise<ExtrairResult> {
    const nome = arquivo.trim();
    if (!nome || /[\\/]/.test(nome) || nome === '.' || nome === '..') {
      return { ok: false, erro: 'nome de arquivo inválido' };
    }
    const ext = path.extname(nome).toLowerCase();
    if (!this.extratorPara(ext)) {
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
    const ext = path.extname(safeName).toLowerCase();
    const extrator = this.extratorPara(ext);
    if (!extrator) {
      return erroExtensao(ext);
    }

    return this.pastas.comSessao(async (pasta) => {
      try {
        const arquivo = path.join(pasta, safeName);
        await fs.writeFile(arquivo, buffer);
        return { ok: true, ...(await extrator.extrair(arquivo, pasta)) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Falha ao extrair ${safeName}: ${msg}`);
        return { ok: false, erro: msg };
      }
    });
  }

  private extratorPara(ext: string): Extrator | undefined {
    return this.extratores.find((e) => e.suporta(ext));
  }
}
