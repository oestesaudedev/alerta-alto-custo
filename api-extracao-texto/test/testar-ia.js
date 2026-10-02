// Confere as regras do IaService (mascaramento antes do envio, validação e falhas) com um ModeloIa falso.
// Uso: npm run build && npm run test:ia (não precisa da API no ar nem da chave da Anthropic)
require('reflect-metadata');
const { Logger } = require('@nestjs/common');
const { IaService } = require('../dist/extracao/ia/ia.service');

Logger.overrideLogger(false);

const config = { get: (_nome, padrao) => padrao };
const medicamentos = [
  { codigo: '001', descricao: 'INFLIXIMABE 100MG', termos: ['REMICADE'] },
  { codigo: '002', descricao: 'RITUXIMABE 500MG' },
];

function modeloFalso(responder) {
  const pedidos = [];
  return {
    nome: 'falso',
    pedidos,
    async extrair(pedido) {
      pedidos.push(pedido);
      return responder(pedido);
    },
  };
}

let falhas = 0;

function caso(nome, ok, detalhe) {
  console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${nome}`);
  if (!ok) {
    falhas++;
    console.log(`       ${detalhe}`);
  }
}

async function main() {
  const desligada = await new IaService(config, null).analisar('texto', medicamentos);
  caso('IA desligada', !desligada.ok && /IA_HABILITADA/.test(desligada.erro), JSON.stringify(desligada));

  const modelo = modeloFalso(() => ({
    modelo: 'falso-1',
    tokens: { entrada: 1, cache: 0, saida: 1 },
    dados: {
      achados: [
        { codigo: '001', termo: 'Remicade', contexto: 'solicitado', confianca: 'media', motivo: 'nome comercial de infliximabe' },
        { codigo: '001', termo: 'INFLIXIMABE', contexto: 'solicitado', confianca: 'alta', motivo: 'nome exato da lista' },
        { codigo: '999', termo: 'Inventado', contexto: 'solicitado', confianca: 'alta', motivo: 'fora da lista' },
        { codigo: '002', termo: 'Rituximabe', contexto: 'solicitado', confianca: 'certeza', motivo: 'confiança inválida' },
      ],
    },
  }));
  const ok = await new IaService(config, modelo).analisar(
    'Paciente: João Carlos da Silva\nCPF 123.456.789-09\nSolicito REMICADE (INFLIXIMABE)',
    medicamentos,
    ['JOÃO CARLOS DA SILVA'],
  );

  const enviado = modelo.pedidos[0] ?? {};
  caso(
    'texto enviado ao modelo vai mascarado',
    /\[NOME\]/.test(enviado.texto) && /\[CPF\]/.test(enviado.texto) && !/Jo[aã]o|Silva|123\.456/i.test(enviado.texto),
    enviado.texto,
  );
  caso(
    'lista de medicamentos vai no contexto',
    /001 \| INFLIXIMABE 100MG \| REMICADE/.test(enviado.contexto) && /002 \| RITUXIMABE 500MG/.test(enviado.contexto),
    enviado.contexto,
  );
  caso(
    'descarta código fora da lista e confiança inválida; mantém a maior confiança por código',
    ok.ok && ok.modelo === 'falso-1' && ok.achados.length === 1 &&
      ok.achados[0].codigo === '001' && ok.achados[0].confianca === 'alta' && ok.achados[0].contexto === 'solicitado',
    JSON.stringify(ok),
  );
  caso(
    'prompt trata folheto, bula e termo de consentimento como informativo',
    /folheto/.test(enviado.instrucoes) && /bula/.test(enviado.instrucoes) && /termo de consentimento/.test(enviado.instrucoes),
    enviado.instrucoes,
  );
  caso(
    'prompt trata "paciente em uso de" sem pedido como historico',
    /paciente em uso de/.test(enviado.instrucoes) && /Estar em uso não é pedido de cobertura/.test(enviado.instrucoes),
    enviado.instrucoes,
  );
  const item = enviado.saida?.esquema?.properties?.achados?.items ?? {};
  caso(
    'esquema exige contexto com os valores aceitos',
    (item.required ?? []).includes('contexto') &&
      JSON.stringify(item.properties?.contexto?.enum) === JSON.stringify(['solicitado', 'informativo', 'historico', 'outro']),
    JSON.stringify(item),
  );

  const folheto = modeloFalso(() => ({
    modelo: 'falso-1',
    tokens: { entrada: 1, cache: 0, saida: 1 },
    dados: {
      achados: [
        { codigo: '001', termo: 'Remicade', contexto: 'informativo', confianca: 'alta', motivo: 'folheto de reações adversas' },
        { codigo: '002', termo: 'Rituximabe', contexto: 'historico', confianca: 'alta', motivo: 'citado como uso anterior' },
      ],
    },
  }));
  const informativo = await new IaService(config, folheto).analisar('Possíveis reações ao usar Remicade', medicamentos);
  caso('contextos informativo e historico são descartados', informativo.ok && informativo.achados.length === 0, JSON.stringify(informativo));

  const semContexto = modeloFalso(() => ({
    modelo: 'falso-1',
    tokens: { entrada: 1, cache: 0, saida: 1 },
    dados: {
      achados: [
        { codigo: '001', termo: 'Remicade', confianca: 'alta', motivo: 'sem contexto' },
        { codigo: '002', termo: 'Rituximabe', contexto: 'pedido', confianca: 'alta', motivo: 'contexto inválido' },
      ],
    },
  }));
  const invalido = await new IaService(config, semContexto).analisar('Remicade e Rituximabe', medicamentos);
  caso('contexto ausente ou inválido é descartado', invalido.ok && invalido.achados.length === 0, JSON.stringify(invalido));

  const misto = modeloFalso(() => ({
    modelo: 'falso-1',
    tokens: { entrada: 1, cache: 0, saida: 1 },
    dados: {
      achados: [
        { codigo: '001', termo: 'Remicade', contexto: 'outro', confianca: 'alta', motivo: 'citado sem pedido' },
        { codigo: '001', termo: 'Infliximabe', contexto: 'solicitado', confianca: 'media', motivo: 'solicitado no relatório' },
      ],
    },
  }));
  const umSolicitado = await new IaService(config, misto).analisar('Remicade ... solicito infliximabe', medicamentos);
  caso(
    'mesmo código citado e solicitado: fica o solicitado',
    umSolicitado.ok && umSolicitado.achados.length === 1 && umSolicitado.achados[0].termo === 'Infliximabe',
    JSON.stringify(umSolicitado),
  );

  const semCodigo = modeloFalso(() => ({ modelo: 'falso-1', tokens: { entrada: 0, cache: 0, saida: 0 }, dados: null }));
  const vazio = await new IaService(config, semCodigo).analisar('texto qualquer', medicamentos);
  caso('resposta sem achados vira lista vazia', vazio.ok && vazio.achados.length === 0, JSON.stringify(vazio));

  caso('texto dentro do limite não vem marcado como cortado', vazio.ok && vazio.cortado === undefined, JSON.stringify(vazio));
  const curto = { get: (nome, padrao) => (nome === 'IA_MAX_CHARS' ? '10' : padrao) };
  const cortou = modeloFalso(() => ({ modelo: 'falso-1', tokens: { entrada: 0, cache: 0, saida: 0 }, dados: null }));
  const cortado = await new IaService(curto, cortou).analisar('0123456789ABCDEF', medicamentos);
  caso(
    'texto acima de IA_MAX_CHARS: envia só o início e marca cortado',
    cortado.ok && cortado.cortado === true && /0123456789$/.test(cortou.pedidos[0].texto),
    JSON.stringify({ cortado, texto: cortou.pedidos[0]?.texto }),
  );

  const quebrado = modeloFalso(() => {
    throw new Error('timeout do provedor');
  });
  const erro = await new IaService(config, quebrado).analisar('texto qualquer', medicamentos);
  caso('falha do provedor volta como ok: false, sem lançar', !erro.ok && erro.erro === 'timeout do provedor', JSON.stringify(erro));

  console.log(`\n${falhas === 0 ? 'Todos os testes passaram.' : `${falhas} falha(s).`}`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
