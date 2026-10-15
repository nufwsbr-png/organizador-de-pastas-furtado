import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

interface Aberto {
  doc: PDFDocumentProxy;
  fechar: () => Promise<void>;
}

async function abrir(arquivo: string): Promise<Aberto> {
  const dados = new Uint8Array(readFileSync(arquivo));
  const tarefa = getDocument({ data: dados, useSystemFonts: true, isEvalSupported: false });
  const doc = await tarefa.promise;
  return { doc, fechar: () => tarefa.destroy() };
}

export async function contarPaginas(arquivo: string): Promise<number> {
  const { doc, fechar } = await abrir(arquivo);
  try {
    return doc.numPages;
  } finally {
    await fechar();
  }
}

/** Texto de todas as páginas (vazio ou quase vazio em PDF digitalizado). */
export async function extrairTexto(arquivo: string, maxPaginas = 50): Promise<string> {
  const { doc, fechar } = await abrir(arquivo);
  try {
    const partes: string[] = [];
    const total = Math.min(doc.numPages, maxPaginas);
    for (let i = 1; i <= total; i++) {
      const pagina = await doc.getPage(i);
      const conteudo = await pagina.getTextContent();
      const linha = conteudo.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('');
      partes.push(linha.replace(/[ \t]+\n/g, '\n').trim());
      pagina.cleanup();
    }
    return partes.join('\n\n');
  } finally {
    await fechar();
  }
}

export interface OpcoesRaster {
  maxPaginas?: number;
  /** 1 = 72 dpi; 1.5 ≈ 108 dpi, bom para leitura por IA. */
  escala?: number;
}

/** Gera `pagina-N.png` para as primeiras páginas e devolve os caminhos. */
export async function rasterizar(arquivo: string, pastaSaida: string, opcoes: OpcoesRaster = {}): Promise<string[]> {
  const { maxPaginas = 2, escala = 1.5 } = opcoes;
  mkdirSync(pastaSaida, { recursive: true });
  const { doc, fechar } = await abrir(arquivo);
  try {
    const saidas: string[] = [];
    const total = Math.min(doc.numPages, maxPaginas);
    for (let i = 1; i <= total; i++) {
      const pagina = await doc.getPage(i);
      const viewport = pagina.getViewport({ scale: escala });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await pagina.render({ canvasContext: ctx as any, viewport } as any).promise;
      const destino = join(pastaSaida, `pagina-${i}.png`);
      writeFileSync(destino, canvas.toBuffer('image/png'));
      saidas.push(destino);
      pagina.cleanup();
    }
    return saidas;
  } finally {
    await fechar();
  }
}
