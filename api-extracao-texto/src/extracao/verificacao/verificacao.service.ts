import { Injectable, Logger } from '@nestjs/common';
import { ExtrairResult } from '../dto/extrair.dto';
import { OpcoesVerificacao, VerificarResult } from '../dto/verificar.dto';
import { ExtracaoService } from '../extracao.service';
import { IaService } from '../ia/ia.service';
import { classificarIa } from './classificacao-ia';

// Extração + IA: devolve os medicamentos de alto custo do anexo prontos para o alerta
@Injectable()
export class VerificacaoService {
  private readonly logger = new Logger(VerificacaoService.name);

  constructor(
    private readonly extracao: ExtracaoService,
    private readonly ia: IaService,
  ) {}

  async verificar(nome: string, conteudoBase64: string, opcoes: OpcoesVerificacao): Promise<VerificarResult> {
    return this.verificarTexto(await this.extracao.extrair(nome, conteudoBase64), opcoes);
  }

  async verificarDoSftp(arquivo: string, ambiente: string, opcoes: OpcoesVerificacao): Promise<VerificarResult> {
    return this.verificarTexto(await this.extracao.extrairDoSftp(arquivo, ambiente), opcoes);
  }

  // Sem a IA não há verificação: a falha volta como erro para o job tentar de novo depois
  private async verificarTexto(extraido: ExtrairResult, opcoes: OpcoesVerificacao): Promise<VerificarResult> {
    if (!extraido.ok) {
      return extraido;
    }
    const ia = await this.ia.analisar(extraido.texto, opcoes.medicamentos, opcoes.mascarar ?? []);
    if (!ia.ok) {
      return { ok: false, erro: `IA indisponivel: ${ia.erro}` };
    }
    const { achados, avisos } = classificarIa(ia);

    this.logger.log(`Verificação (${extraido.metodo}): ${achados.length} achado(s), ${avisos.length} aviso(s)`);

    return {
      ok: true,
      metodo: extraido.metodo,
      modelo: ia.modelo,
      achados,
      avisos,
      ...(opcoes.retornarTexto && { texto: extraido.texto }),
    };
  }
}
