// Fase 4: chama POST /extrair e /verificar com as amostras e valida as respostas.
// Uso: node test/e2e/testar-api.js (API com EXTRAIR_BASE64=true, como no docker-compose.dev.yml)
// Env: API_URL (padrão http://localhost:3010/extrair), API_TOKEN (obrigatório), AMOSTRAS_DIR,
//      SFTP_ARQUIVO (nome de um arquivo existente no SFTP para testar /extrair-sftp),
//      SFTP_AMBIENTE_TESTE (ambiente Protheus enviado ao /extrair-sftp; padrão CYWSXT_DEV),
//      IA_TESTE=true (exige que o Claude ache os medicamentos da comercial.pdf; API com IA_HABILITADA=true)
// Arquivos extras em amostras/reais/ são enviados e só têm o texto exibido.
const fs = require('fs');
const path = require('path');

const API_URL = process.env.API_URL || 'http://localhost:3010/extrair';
const API_SFTP_URL = API_URL.replace(/\/extrair$/, '/extrair-sftp');
const API_VERIFICAR_URL = API_URL.replace(/\/extrair$/, '/verificar');
const API_VERIFICAR_SFTP_URL = API_URL.replace(/\/extrair$/, '/verificar-sftp');
const API_CONFIG_URL = API_URL.replace(/\/extrair$/, '/config');
const API_TOKEN = process.env.API_TOKEN || '';
const AMOSTRAS_DIR = process.env.AMOSTRAS_DIR || path.join(__dirname, 'amostras');
const SFTP_ARQUIVO = process.env.SFTP_ARQUIVO || '';
// Ambiente do Protheus simulado nas chamadas /extrair-sftp (CYWSXT_PROD usa o SFTP de produção)
const SFTP_AMBIENTE = process.env.SFTP_AMBIENTE_TESTE || 'CYWSXT_DEV';

const ESPERADO = ['INFLIXIMABE', 'REMICADE'];
const IA_TESTE = String(process.env.IA_TESTE || '').toLowerCase() === 'true';

// Códigos fictícios; comercial.pdf cita REMICADE (infliximabe) e STELARA (ustequinumabe), não rituximabe
const MEDICAMENTOS_IA = [
  { codigo: '90000001', descricao: 'INFLIXIMABE 100MG', termos: ['INFLIXIMABE'] },
  { codigo: '90000002', descricao: 'USTEQUINUMABE 45MG', termos: ['USTEQUINUMABE'] },
  { codigo: '90000003', descricao: 'RITUXIMABE 500MG', termos: ['RITUXIMABE'] },
];

let falhas = 0;

function normalizar(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function resultado(nome, ok, detalhe) {
  console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas++;
}

async function post(body, token = API_TOKEN, url = API_URL) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const inicio = Date.now();
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, ms: Date.now() - inicio };
}

async function enviarArquivo(arquivo) {
  const buf = fs.readFileSync(arquivo);
  return post({ nome: path.basename(arquivo), conteudoBase64: buf.toString('base64') });
}

async function testarAmostra(arquivo, metodoEsperado) {
  const alvo = path.join(AMOSTRAS_DIR, arquivo);
  if (!fs.existsSync(alvo)) {
    resultado(`${arquivo} (${metodoEsperado})`, false, 'amostra não encontrada — rode gerar-amostras.js');
    return;
  }
  const { status, json, ms } = await enviarArquivo(alvo);
  const texto = json && json.ok ? normalizar(json.texto) : '';
  const achados = ESPERADO.filter((p) => texto.includes(p));
  resultado(
    `${arquivo} (${metodoEsperado})`,
    status === 200 &&
      json &&
      json.ok &&
      json.metodo === metodoEsperado &&
      achados.length === ESPERADO.length,
    `HTTP ${status}, ${ms} ms, metodo=${json && json.metodo}, encontrou [${achados.join(', ')}]` +
      (json && !json.ok ? `, erro: ${json.erro}` : ''),
  );
  if (json && json.ok) {
    console.log(`       trecho: ${json.texto.replace(/\s+/g, ' ').slice(0, 120)}`);
  }
}

// Sem IA_TESTE, só confere que o campo "ia" volta (ok:false com a IA desligada é aceito)
async function testarIa() {
  const alvo = path.join(AMOSTRAS_DIR, 'comercial.pdf');
  if (!fs.existsSync(alvo)) {
    resultado('ia: comercial.pdf', false, 'amostra não encontrada — rode gerar-amostras.js');
    return;
  }
  const { status, json, ms } = await post({
    nome: 'comercial.pdf',
    conteudoBase64: fs.readFileSync(alvo).toString('base64'),
    medicamentos: MEDICAMENTOS_IA,
    mascarar: ['PACIENTE DE TESTE', '00010002000123001'],
  });
  const ia = json && json.ok ? json.ia : undefined;
  const codigos = ia && ia.ok ? ia.achados.map((a) => a.codigo) : [];
  const detalhe =
    `HTTP ${status}, ${ms} ms, ia=${JSON.stringify(ia)}` + (json && !json.ok ? `, erro: ${json.erro}` : '');

  if (!IA_TESTE) {
    resultado('ia: campo "ia" na resposta', status === 200 && !!ia, detalhe);
    return;
  }
  resultado(
    'ia: nomes comerciais → infliximabe e ustequinumabe, sem rituximabe',
    status === 200 &&
      !!ia &&
      ia.ok === true &&
      codigos.includes('90000001') &&
      codigos.includes('90000002') &&
      !codigos.includes('90000003'),
    detalhe,
  );

  const semLista = await post({ nome: 'comercial.pdf', conteudoBase64: fs.readFileSync(alvo).toString('base64') });
  resultado(
    'ia: sem lista de medicamentos → sem campo "ia"',
    semLista.status === 200 && semLista.json && semLista.json.ok && semLista.json.ia === undefined,
    `HTTP ${semLista.status}`,
  );
}

// /verificar: a IA decide. Sem IA_TESTE aceita "IA indisponivel"; com IA_TESTE exige os achados da comercial.pdf
async function testarVerificacao() {
  const texto = path.join(AMOSTRAS_DIR, 'texto.pdf');
  const comercial = path.join(AMOSTRAS_DIR, 'comercial.pdf');
  if (!fs.existsSync(texto) || !fs.existsSync(comercial)) {
    resultado('verificar: amostras', false, 'amostra não encontrada — rode gerar-amostras.js');
    return;
  }
  const base64 = (arquivo) => fs.readFileSync(arquivo).toString('base64');
  const codigos = (json) => (json && json.ok ? json.achados.filter((a) => a.origem === 'ia').map((a) => a.codigo) : []);
  const okOuSemIa = (r) =>
    r.status === 200 && r.json && (r.json.ok === true || /^IA indisponivel/.test(String(r.json.erro)));

  const semLista = await post({ nome: 'texto.pdf', conteudoBase64: base64(texto) }, API_TOKEN, API_VERIFICAR_URL);
  resultado(
    'verificar: sem lista de medicamentos → 400 {ok:false}',
    semLista.status === 400 && semLista.json && semLista.json.ok === false,
    `HTTP ${semLista.status}, ${JSON.stringify(semLista.json)}`,
  );

  const campoAntigo = await post(
    { nome: 'texto.pdf', conteudoBase64: base64(texto), medicamentos: MEDICAMENTOS_IA, ia: 'ativa' },
    API_TOKEN,
    API_VERIFICAR_URL,
  );
  resultado(
    'verificar: campo "ia" não existe mais → 400 {ok:false}',
    campoAntigo.status === 400 && campoAntigo.json && campoAntigo.json.ok === false,
    `HTTP ${campoAntigo.status}, ${JSON.stringify(campoAntigo.json)}`,
  );

  const longa = await post(
    {
      nome: 'texto.pdf',
      conteudoBase64: base64(texto),
      medicamentos: [...MEDICAMENTOS_IA, { codigo: '90000004', descricao: 'X'.repeat(500), termos: ['Y'.repeat(500)] }],
    },
    API_TOKEN,
    API_VERIFICAR_URL,
  );
  resultado(
    'verificar: descrição e termo com 500 caracteres são aceitos',
    okOuSemIa(longa),
    `HTTP ${longa.status}, ${JSON.stringify(longa.json && (longa.json.achados || longa.json.erro))}`,
  );

  const sftpInexistente = await post(
    { arquivo: `nao-existe-${Date.now()}.pdf`, ambiente: SFTP_AMBIENTE, medicamentos: MEDICAMENTOS_IA },
    API_TOKEN,
    API_VERIFICAR_SFTP_URL,
  );
  resultado(
    'verificar-sftp: arquivo inexistente → {ok:false, não encontrado}',
    sftpInexistente.status === 200 &&
      sftpInexistente.json &&
      sftpInexistente.json.ok === false &&
      /não encontrado/.test(sftpInexistente.json.erro),
    `HTTP ${sftpInexistente.status}, erro: ${sftpInexistente.json && sftpInexistente.json.erro}`,
  );

  if (!IA_TESTE) {
    return;
  }
  const corpo = { nome: 'comercial.pdf', conteudoBase64: base64(comercial), medicamentos: MEDICAMENTOS_IA, mascarar: ['PACIENTE DE TESTE'] };

  const ia = await post(corpo, API_TOKEN, API_VERIFICAR_URL);
  const daIa = codigos(ia.json);
  resultado(
    'verificar: infliximabe e ustequinumabe nos achados com origem ia, sem rituximabe e sem texto',
    ia.status === 200 &&
      daIa.includes('90000001') &&
      daIa.includes('90000002') &&
      !daIa.includes('90000003') &&
      ia.json.texto === undefined &&
      !!ia.json.modelo,
    `HTTP ${ia.status}, ${ia.ms} ms, ${JSON.stringify(ia.json && (ia.json.achados || ia.json.erro))}`,
  );

  const comTexto = await post({ ...corpo, retornarTexto: true }, API_TOKEN, API_VERIFICAR_URL);
  resultado(
    'verificar: retornarTexto devolve o texto',
    comTexto.status === 200 && comTexto.json && comTexto.json.ok && comTexto.json.texto.length > 0,
    `HTTP ${comTexto.status}`,
  );
}

// GET /config: o job lê daqui se a IA está ligada; com IA_TESTE ela precisa estar
async function testarConfig() {
  const get = async (token) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(API_CONFIG_URL, { headers });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  const semToken = await get(null);
  resultado('config: sem token → 401', semToken.status === 401, `HTTP ${semToken.status}`);

  const cfg = await get(API_TOKEN);
  resultado(
    `config: ia booleano${IA_TESTE ? ' e ligada' : ''}`,
    cfg.status === 200 &&
      cfg.json &&
      cfg.json.ok === true &&
      typeof cfg.json.ia === 'boolean' &&
      (!IA_TESTE || (cfg.json.ia === true && !!cfg.json.modelo)),
    `HTTP ${cfg.status}, ${JSON.stringify(cfg.json)}`,
  );
  resultado(
    'config: criterio altcus, ou valor com valorMin > 0',
    !!cfg.json &&
      (cfg.json.criterio === 'altcus' || (cfg.json.criterio === 'valor' && cfg.json.valorMin > 0)),
    `criterio=${cfg.json && cfg.json.criterio}, valorMin=${cfg.json && cfg.json.valorMin}`,
  );
}

async function main() {
  if (!API_TOKEN) {
    console.error('Defina API_TOKEN com o mesmo valor do .env da API.');
    process.exit(1);
  }
  console.log(`API: ${API_URL}\n`);

  const sonda = await post({ nome: 'a.pdf', conteudoBase64: 'YQ==' });
  if (sonda.status === 404) {
    console.error('POST /extrair desabilitado: suba a API com EXTRAIR_BASE64=true (docker-compose.dev.yml).');
    process.exit(1);
  }

  await testarAmostra('texto.pdf', 'pdf-parse');
  await testarAmostra('imagem.jpg', 'ocr-imagem');
  await testarAmostra('escaneado.pdf', 'ocr-pdf');
  await testarIa();
  await testarVerificacao();
  await testarConfig();

  const semToken = await post({ nome: 'a.pdf', conteudoBase64: 'YQ==' }, null);
  resultado('sem token → 401', semToken.status === 401, `HTTP ${semToken.status}`);

  const tokenErrado = await post({ nome: 'a.pdf', conteudoBase64: 'YQ==' }, 'errado');
  resultado('token errado → 401', tokenErrado.status === 401, `HTTP ${tokenErrado.status}`);

  const tokenPadrao = await post({ nome: 'a.pdf', conteudoBase64: 'YQ==' }, 'dev-change-me');
  resultado('token dev-change-me → 401', tokenPadrao.status === 401, `HTTP ${tokenPadrao.status}`);

  const semNome = await post({ conteudoBase64: 'YQ==' });
  resultado(
    'sem nome → 400 {ok:false}',
    semNome.status === 400 && semNome.json && semNome.json.ok === false,
    `HTTP ${semNome.status}, ${JSON.stringify(semNome.json)}`,
  );

  const extensao = await post({ nome: 'planilha.xlsx', conteudoBase64: 'YQ==' });
  resultado(
    'extensão não suportada → {ok:false}',
    extensao.json && extensao.json.ok === false,
    extensao.json && extensao.json.erro,
  );

  const sftpSemToken = await post({ arquivo: 'a.pdf', ambiente: SFTP_AMBIENTE }, null, API_SFTP_URL);
  resultado('sftp: sem token → 401', sftpSemToken.status === 401, `HTTP ${sftpSemToken.status}`);

  const sftpSemArquivo = await post({ ambiente: SFTP_AMBIENTE }, API_TOKEN, API_SFTP_URL);
  resultado(
    'sftp: sem arquivo → 400 {ok:false}',
    sftpSemArquivo.status === 400 && sftpSemArquivo.json && sftpSemArquivo.json.ok === false,
    `HTTP ${sftpSemArquivo.status}, ${JSON.stringify(sftpSemArquivo.json)}`,
  );

  const sftpSemAmbiente = await post({ arquivo: 'a.pdf' }, API_TOKEN, API_SFTP_URL);
  resultado(
    'sftp: sem ambiente → 400 {ok:false}',
    sftpSemAmbiente.status === 400 && sftpSemAmbiente.json && sftpSemAmbiente.json.ok === false,
    `HTTP ${sftpSemAmbiente.status}, ${JSON.stringify(sftpSemAmbiente.json)}`,
  );

  const sftpCaminho = await post(
    { arquivo: '../etc/passwd.pdf', ambiente: SFTP_AMBIENTE },
    API_TOKEN,
    API_SFTP_URL,
  );
  resultado(
    'sftp: caminho no nome → {ok:false}',
    sftpCaminho.json && sftpCaminho.json.ok === false,
    sftpCaminho.json && sftpCaminho.json.erro,
  );

  const sftpInexistente = await post(
    { arquivo: `nao-existe-${Date.now()}.pdf`, ambiente: SFTP_AMBIENTE },
    API_TOKEN,
    API_SFTP_URL,
  );
  resultado(
    'sftp: arquivo inexistente → {ok:false, não encontrado}',
    sftpInexistente.status === 200 &&
      sftpInexistente.json &&
      sftpInexistente.json.ok === false &&
      /não encontrado/.test(sftpInexistente.json.erro),
    `HTTP ${sftpInexistente.status}, ${sftpInexistente.ms} ms, erro: ${sftpInexistente.json && sftpInexistente.json.erro}`,
  );

  if (SFTP_ARQUIVO) {
    const real = await post({ arquivo: SFTP_ARQUIVO, ambiente: SFTP_AMBIENTE }, API_TOKEN, API_SFTP_URL);
    resultado(
      `sftp: ${SFTP_ARQUIVO} → texto extraído`,
      real.status === 200 && real.json && real.json.ok === true && real.json.texto.length > 0,
      `HTTP ${real.status}, ${real.ms} ms, metodo=${real.json && real.json.metodo}` +
        (real.json && !real.json.ok ? `, erro: ${real.json.erro}` : ''),
    );
    if (real.json && real.json.ok) {
      console.log(`       trecho: ${real.json.texto.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }

  const reaisDir = path.join(AMOSTRAS_DIR, 'reais');
  if (fs.existsSync(reaisDir)) {
    const reais = fs.readdirSync(reaisDir).filter((f) => !f.startsWith('.'));
    if (reais.length) console.log('\nArquivos reais (sem asserção):');
    for (const f of reais) {
      const { status, json, ms } = await enviarArquivo(path.join(reaisDir, f));
      console.log(`  ${f}: HTTP ${status}, ${ms} ms, ok=${json && json.ok}, metodo=${json && json.metodo}`);
      const texto = json ? (json.ok ? json.texto : json.erro) : '';
      console.log(`    ${String(texto).replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  }

  console.log(`\n${falhas === 0 ? 'Todos os testes passaram.' : `${falhas} falha(s).`}`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
