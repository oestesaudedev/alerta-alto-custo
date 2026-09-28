// Fase 4: chama POST /extrair com as 3 amostras e valida as respostas.
// Uso: node test/e2e/testar-api.js
// Env: API_URL (padrão http://localhost:3010/extrair), API_TOKEN, AMOSTRAS_DIR,
//      SFTP_ARQUIVO (nome de um arquivo existente no SFTP para testar /extrair-sftp)
// Arquivos extras em amostras/reais/ são enviados e só têm o texto exibido.
const fs = require('fs');
const path = require('path');

const API_URL = process.env.API_URL || 'http://localhost:3010/extrair';
const API_SFTP_URL = API_URL.replace(/\/extrair$/, '/extrair-sftp');
const API_TOKEN = process.env.API_TOKEN || 'dev-change-me';
const AMOSTRAS_DIR = process.env.AMOSTRAS_DIR || path.join(__dirname, 'amostras');
const SFTP_ARQUIVO = process.env.SFTP_ARQUIVO || '';

const ESPERADO = ['INFLIXIMABE', 'REMICADE'];

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

async function main() {
  console.log(`API: ${API_URL}\n`);

  await testarAmostra('texto.pdf', 'pdf-parse');
  await testarAmostra('imagem.jpg', 'ocr-imagem');
  await testarAmostra('escaneado.pdf', 'ocr-pdf');

  const semToken = await post({ nome: 'a.pdf', conteudoBase64: 'YQ==' }, null);
  resultado('sem token → 401', semToken.status === 401, `HTTP ${semToken.status}`);

  const tokenErrado = await post({ nome: 'a.pdf', conteudoBase64: 'YQ==' }, 'errado');
  resultado('token errado → 401', tokenErrado.status === 401, `HTTP ${tokenErrado.status}`);

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

  const sftpSemToken = await post({ arquivo: 'a.pdf' }, null, API_SFTP_URL);
  resultado('sftp: sem token → 401', sftpSemToken.status === 401, `HTTP ${sftpSemToken.status}`);

  const sftpSemArquivo = await post({}, API_TOKEN, API_SFTP_URL);
  resultado(
    'sftp: sem arquivo → 400 {ok:false}',
    sftpSemArquivo.status === 400 && sftpSemArquivo.json && sftpSemArquivo.json.ok === false,
    `HTTP ${sftpSemArquivo.status}, ${JSON.stringify(sftpSemArquivo.json)}`,
  );

  const sftpCaminho = await post({ arquivo: '../etc/passwd.pdf' }, API_TOKEN, API_SFTP_URL);
  resultado(
    'sftp: caminho no nome → {ok:false}',
    sftpCaminho.json && sftpCaminho.json.ok === false,
    sftpCaminho.json && sftpCaminho.json.erro,
  );

  const sftpInexistente = await post(
    { arquivo: `nao-existe-${Date.now()}.pdf` },
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
    const real = await post({ arquivo: SFTP_ARQUIVO }, API_TOKEN, API_SFTP_URL);
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
