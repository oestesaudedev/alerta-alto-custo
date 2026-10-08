import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExtrairResult } from '../dto/extrair.dto';
import { OpcoesVerificacao, VerificarResult } from '../dto/verificar.dto';
import { ExtracaoService } from '../extracao.service';
import { IaService } from '../ia/ia.service';
import { classificarIa } from './classificacao-ia';
import { ListaMedicamentosService } from './lista-medicamentos.service';
import { buscarCandidatos, IndicePreBusca, montarIndice } from './pre-busca';

// O job reconhece esta frase e reenvia a lista (POST /medicamentos) antes de tentar de novo
export const ERRO_LISTA_DESCONHECIDA = 'lista de medicamentos desconhecida: reenviar';

// Extração + pré-busca + IA: devolve os medicamentos de alto custo do anexo prontos para o alerta
@Injectable()
export class VerificacaoService {
  private readonly logger = new Logger(VerificacaoService.name);
  private readonly maxChars: number;
  private readonly maxCandidatos: number;

  constructor(
    private readonly extracao: ExtracaoService,
    private readonly ia: IaService,
    private readonly listas: ListaMedicamentosService,
    config: ConfigService,
  ) {
    this.maxChars = Number(config.get('IA_MAX_CHARS', '100000')) || 100000;
    this.maxCandidatos = Number(config.get('PRE_BUSCA_MAX_CANDIDATOS', '300')) || 300;
  }

  async verificar(nome: string, conteudoBase64: string, opcoes: OpcoesVerificacao): Promise<VerificarResult> {
    const indice = this.indice(opcoes);
    if (typeof indice === 'string') return { ok: false, erro: indice };
    return this.verificarTexto(await this.extracao.extrair(nome, conteudoBase64), indice, opcoes);
  }

  async verificarDoSftp(arquivo: string, ambiente: string, opcoes: OpcoesVerificacao): Promise<VerificarResult> {
    const indice = this.indice(opcoes);
    if (typeof indice === 'string') return { ok: false, erro: indice };
    return this.verificarTexto(await this.extracao.extrairDoSftp(arquivo, ambiente), indice, opcoes);
  }

  // Resolvido antes da extração, para não baixar o anexo à toa; string = erro
  private indice(opcoes: OpcoesVerificacao): IndicePreBusca | string {
    if (opcoes.listaId) {
      return this.listas.obter(opcoes.listaId) ?? ERRO_LISTA_DESCONHECIDA;
    }
    if (opcoes.medicamentos?.length) {
      return montarIndice(opcoes.medicamentos, this.listas.dfMax);
    }
    return 'informe listaId ou medicamentos';
  }

  // Sem a IA não há verificação: a falha volta como erro para o job tentar de novo depois
  private async verificarTexto(
    extraido: ExtrairResult,
    indice: IndicePreBusca,
    opcoes: OpcoesVerificacao,
  ): Promise<VerificarResult> {
    if (!extraido.ok) {
      return extraido;
    }
    // Mesmo trecho que a IA lê (IA_MAX_CHARS): candidato fora dele não seria confirmado
    const inicio = Date.now();
    const pre = buscarCandidatos(indice, extraido.texto.slice(0, this.maxChars), this.maxCandidatos);
    this.logger.log(
      `Pré-busca: ${pre.total} candidato(s)${pre.cortado ? `, IA recebe os ${pre.candidatos.length} primeiros` : ''} ` +
        `em ${Date.now() - inicio} ms`,
    );

    // Sem candidato a IA não é chamada (o IaService devolve achados vazios)
    const ia = await this.ia.analisar(extraido.texto, pre.candidatos, opcoes.mascarar ?? []);
    if (!ia.ok) {
      return { ok: false, erro: `IA indisponivel: ${ia.erro}` };
    }
    const { achados, avisos } = classificarIa(ia);
    if (pre.cortado) {
      avisos.unshift({
        tipo: 'pre-busca-limite',
        codigo: '',
        observacao: `${pre.total} candidatos na pre-busca, IA recebeu os ${pre.candidatos.length} primeiros (PRE_BUSCA_MAX_CANDIDATOS)`,
      });
    }

    this.logger.log(`Verificação (${extraido.metodo}): ${achados.length} achado(s), ${avisos.length} aviso(s)`);

    return {
      ok: true,
      metodo: extraido.metodo,
      modelo: ia.modelo,
      candidatos: pre.candidatos.length,
      achados,
      avisos,
      ...(opcoes.retornarTexto && { texto: extraido.texto }),
    };
  }
}
