import { createWriteStream, existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { createCanvas } from '@napi-rs/canvas';
import { extrairTexto, rasterizar, contarPaginas } from '../src/main/ferramentas/pdf';
import { imagensParaPdf } from '../src/main/ferramentas/imagem';

const PASTA_REAL = process.env.PASTA_ORIGEM ?? '';

function temp(): string {
  return mkdtempSync(join(tmpdir(), 'pdf-'));
}

async function pdfComTexto(destino: string, texto: string, paginas = 1): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument();
    const stream = doc.pipe(createWriteStream(destino));
    for (let i = 0; i < paginas; i++) {
      if (i > 0) doc.addPage();
      doc.fontSize(14).text(`${texto} — página ${i + 1}`);
    }
    doc.end();
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
}

function pngDeTeste(destino: string, cor: string): void {
  const c = createCanvas(200, 100);
  const ctx = c.getContext('2d');
  ctx.fillStyle = cor;
  ctx.fillRect(0, 0, 200, 100);
  writeFileSync(destino, c.toBuffer('image/png'));
}

describe('ferramentas de PDF', () => {
  it('extrai o texto de um PDF com texto', async () => {
    const dir = temp();
    const arquivo = join(dir, 'texto.pdf');
    await pdfComTexto(arquivo, 'Procuração ad judicia da cliente', 2);
    const texto = await extrairTexto(arquivo);
    expect(texto).toContain('Procuração ad judicia');
    expect(texto).toContain('página 2');
    expect(await contarPaginas(arquivo)).toBe(2);
  });

  it('rasteriza as primeiras páginas em PNG', async () => {
    const dir = temp();
    const arquivo = join(dir, 'texto.pdf');
    await pdfComTexto(arquivo, 'Olá', 3);
    const pngs = await rasterizar(arquivo, join(dir, 'png'), { maxPaginas: 2, escala: 1 });
    expect(pngs).toHaveLength(2);
    expect(pngs[0]).toMatch(/pagina-1\.png$/);
    expect(statSync(pngs[0]).size).toBeGreaterThan(500);
  });

  it('PDF só de imagens (perguntas da entrevista) tem pouco texto e rasteriza', async () => {
    const perguntas = join(PASTA_REAL, 'Perguntas entrevista .pdf');
    if (!existsSync(perguntas)) return;
    const texto = await extrairTexto(perguntas);
    expect(texto.trim().length).toBeLessThan(50);
    const pngs = await rasterizar(perguntas, join(temp(), 'png'), { maxPaginas: 20, escala: 1.5 });
    expect(pngs.length).toBe(10);
  }, 60_000);
});

describe('imagens para PDF', () => {
  it('junta imagens em um único PDF, uma por página, na ordem', async () => {
    const dir = temp();
    pngDeTeste(join(dir, 'frente.png'), 'red');
    pngDeTeste(join(dir, 'verso.png'), 'blue');
    const destino = join(dir, 'RG.pdf');
    await imagensParaPdf([join(dir, 'frente.png'), join(dir, 'verso.png')], destino);
    expect(await contarPaginas(destino)).toBe(2);
    expect(readdirSync(dir)).toContain('RG.pdf');
  });
});
