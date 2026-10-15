import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const A4 = { largura: 595.28, altura: 841.89 };

/** Monta um PDF com uma imagem por página (A4, imagem centralizada e ajustada), na ordem dada. */
export async function imagensParaPdf(imagens: string[], destino: string): Promise<void> {
  const pdf = await PDFDocument.create();
  for (const caminho of imagens) {
    const { bytes, tipo } = await comoJpgOuPng(caminho);
    const img = tipo === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const pagina = pdf.addPage([A4.largura, A4.altura]);
    const margem = 36;
    const escala = Math.min((A4.largura - 2 * margem) / img.width, (A4.altura - 2 * margem) / img.height, 1.5);
    const largura = img.width * escala;
    const altura = img.height * escala;
    pagina.drawImage(img, {
      x: (A4.largura - largura) / 2,
      y: (A4.altura - altura) / 2,
      width: largura,
      height: altura,
    });
  }
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, await pdf.save());
}

/** pdf-lib só embute JPG e PNG; outros formatos passam pelo canvas e viram PNG. */
async function comoJpgOuPng(caminho: string): Promise<{ bytes: Uint8Array; tipo: 'jpg' | 'png' }> {
  const ext = extname(caminho).toLowerCase();
  const bytes = new Uint8Array(readFileSync(caminho));
  if (ext === '.jpg' || ext === '.jpeg') return { bytes, tipo: 'jpg' };
  if (ext === '.png') return { bytes, tipo: 'png' };
  const img = await loadImage(bytes);
  const canvas = createCanvas(img.width, img.height);
  canvas.getContext('2d').drawImage(img, 0, 0);
  return { bytes: new Uint8Array(canvas.toBuffer('image/png')), tipo: 'png' };
}
