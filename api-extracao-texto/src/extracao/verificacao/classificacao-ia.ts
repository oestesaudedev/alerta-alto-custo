import { ResultadoIaOk } from '../dto/extrair.dto';
import { AchadoVerificacao, AvisoVerificacao } from '../dto/verificar.dto';

export type ResultadoClassificacao = { achados: AchadoVerificacao[]; avisos: AvisoVerificacao[] };

// Confiança alta ou média entra no alerta; baixa fica só nos avisos.
// Os códigos já chegam validados contra a lista pelo IaService, um achado por código.
export function classificarIa(ia: ResultadoIaOk): ResultadoClassificacao {
  const achados: AchadoVerificacao[] = [];
  const avisos: AvisoVerificacao[] = [];
  if (ia.cortado) {
    avisos.push({ tipo: 'texto-cortado', codigo: '', observacao: 'texto maior que IA_MAX_CHARS: a IA leu so o inicio' });
  }
  for (const a of ia.achados) {
    const observacao = `IA (${a.confianca}): ${a.motivo}`;
    if (a.confianca === 'baixa') {
      avisos.push({ tipo: 'confianca-baixa', codigo: a.codigo, observacao });
    } else {
      achados.push({ codigo: a.codigo, termo: a.termo, origem: 'ia', observacao });
    }
  }
  return { achados, avisos };
}
