// Gera as 3 amostras da fase 4 em test/e2e/amostras/:
//   texto.pdf      PDF com camada de texto (caminho pdf-parse)
//   imagem.jpg     página renderizada com pdftoppm (caminho OCR de imagem)
//   escaneado.pdf  PDF que só contém a imagem, sem texto (caminho pdftoppm + OCR)
// Requer pdftoppm (poppler-utils): rodar dentro do container da API.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.env.AMOSTRAS_DIR || path.join(__dirname, 'amostras');

const LINHAS = [
  'OESTE SAUDE - SOLICITACAO DE MEDICAMENTO',
  'Guia: 000123456789',
  'Beneficiario: PACIENTE DE TESTE',
  'Medicamento solicitado: INFLIXIMABE 100 MG',
  'Nome comercial: REMICADE',
  'Posologia: 5 mg/kg a cada 8 semanas',
  'Medico solicitante: CRM 12345',
];

function escapePdf(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function montarPdf(objetos) {
  const partes = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [];
  let tamanho = partes[0].length;

  objetos.forEach((corpo, i) => {
    offsets.push(tamanho);
    const cab = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
    const rod = Buffer.from('\nendobj\n', 'latin1');
    const buf = Buffer.concat([cab, corpo, rod]);
    partes.push(buf);
    tamanho += buf.length;
  });

  const xrefPos = tamanho;
  let xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  partes.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(partes);
}

function stream(dicionario, dados) {
  return Buffer.concat([
    Buffer.from(`<< ${dicionario} /Length ${dados.length} >>\nstream\n`, 'latin1'),
    dados,
    Buffer.from('\nendstream', 'latin1'),
  ]);
}

function gerarPdfTexto() {
  let conteudo = 'BT /F1 16 Tf 50 780 Td\n';
  LINHAS.forEach((linha, i) => {
    if (i > 0) conteudo += '0 -28 Td\n';
    conteudo += `(${escapePdf(linha)}) Tj\n`;
  });
  conteudo += 'ET';

  return montarPdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    ),
    stream('', Buffer.from(conteudo, 'latin1')),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ]);
}

function dimensoesJpeg(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error('JPEG inválido');
    const marcador = buf[i + 1];
    const tam = buf.readUInt16BE(i + 2);
    const ehSof =
      marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador);
    if (ehSof) {
      return {
        altura: buf.readUInt16BE(i + 5),
        largura: buf.readUInt16BE(i + 7),
        componentes: buf[i + 9],
      };
    }
    i += 2 + tam;
  }
  throw new Error('SOF não encontrado no JPEG');
}

function gerarPdfEscaneado(jpeg) {
  const { largura, altura, componentes } = dimensoesJpeg(jpeg);
  const cor = componentes === 1 ? '/DeviceGray' : '/DeviceRGB';
  return montarPdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>',
    ),
    stream('', Buffer.from('q 595 0 0 842 0 0 cm /Im1 Do Q', 'latin1')),
    stream(
      `/Type /XObject /Subtype /Image /Width ${largura} /Height ${altura} /ColorSpace ${cor} /BitsPerComponent 8 /Filter /DCTDecode`,
      jpeg,
    ),
  ]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const pdfTexto = path.join(OUT_DIR, 'texto.pdf');
fs.writeFileSync(pdfTexto, gerarPdfTexto());

execFileSync('pdftoppm', [
  '-jpeg', '-r', '200', '-singlefile', pdfTexto, path.join(OUT_DIR, 'imagem'),
]);
const jpeg = fs.readFileSync(path.join(OUT_DIR, 'imagem.jpg'));

fs.writeFileSync(path.join(OUT_DIR, 'escaneado.pdf'), gerarPdfEscaneado(jpeg));

for (const f of ['texto.pdf', 'imagem.jpg', 'escaneado.pdf']) {
  const { size } = fs.statSync(path.join(OUT_DIR, f));
  console.log(`gerado ${f} (${(size / 1024).toFixed(1)} KB)`);
}
