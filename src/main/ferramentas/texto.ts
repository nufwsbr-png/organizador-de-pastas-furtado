import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { extrairTexto } from './pdf';

/** Lê um arquivo de texto respeitando BOM e caindo para latin1 quando não é UTF-8 válido. */
export function lerTexto(arquivo: string): string {
  const bruto = readFileSync(arquivo);
  if (bruto.length >= 2 && bruto[0] === 0xff && bruto[1] === 0xfe) return bruto.toString('utf16le').replace(/^\ufeff/, '');
  const utf8 = bruto.toString('utf8');
  if (!utf8.includes('\ufffd')) return utf8.replace(/^\ufeff/, '');
  return bruto.toString('latin1');
}

/** Extrai o texto de um documento (txt, md, docx ou pdf). */
export async function lerDocumentoTexto(arquivo: string): Promise<string> {
  const ext = extname(arquivo).toLowerCase();
  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const r = await mammoth.extractRawText({ path: arquivo });
    return r.value;
  }
  if (ext === '.pdf') return extrairTexto(arquivo, 500);
  return lerTexto(arquivo);
}
