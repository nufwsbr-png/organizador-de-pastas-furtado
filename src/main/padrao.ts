import { basename, extname } from 'node:path';

/** Pastas da estrutura final de cada cliente. */
export const PASTAS_PADRAO = ['Contratos', 'Documentos', 'Não juntar', 'Entrevista'] as const;
export type PastaPadrao = (typeof PASTAS_PADRAO)[number];

export interface DocumentoPadrao {
  /** Nome final do arquivo, sem extensão. */
  nome: string;
  pasta: PastaPadrao;
  /** Extensões aceitas; vazio = qualquer. */
  extensoes: readonly string[];
}

export const DOCUMENTOS_PADRAO: readonly DocumentoPadrao[] = [
  { nome: 'Procuração', pasta: 'Contratos', extensoes: ['.pdf'] },
  { nome: 'Declaração', pasta: 'Contratos', extensoes: ['.pdf'] },
  { nome: 'RG', pasta: 'Documentos', extensoes: ['.pdf'] },
  { nome: 'CNH', pasta: 'Documentos', extensoes: ['.pdf'] },
  { nome: 'CTPS', pasta: 'Documentos', extensoes: ['.pdf'] },
  { nome: 'Contrato Trabalhista', pasta: 'Não juntar', extensoes: ['.pdf'] },
  { nome: 'Comprovante de residência', pasta: 'Não juntar', extensoes: ['.pdf'] },
  { nome: 'Perguntas entrevista', pasta: 'Entrevista', extensoes: ['.pdf'] },
  { nome: 'Áudio da ligação', pasta: 'Entrevista', extensoes: [] },
  { nome: 'Entrevista preenchida', pasta: 'Entrevista', extensoes: ['.pdf'] },
  { nome: 'Transcrição', pasta: 'Entrevista', extensoes: ['.txt', '.docx', '.pdf', '.md'] },
];

export type TipoDocumento = (typeof DOCUMENTOS_PADRAO)[number]['nome'];

/** Pastas internas do organizador que nunca são mexidas. */
export const PASTAS_INTERNAS = ['_substituidos', 'Revisar'] as const;
const ARQUIVOS_IGNORADOS = ['thumbs.db', 'desktop.ini', '.ds_store'];

const EXT_AUDIO = ['.wav', '.mp3', '.m4a', '.ogg', '.opus', '.aac', '.flac', '.wma', '.amr', '.mp4', '.webm'];
const EXT_IMAGEM = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff'];

export type Situacao =
  | { situacao: 'no-lugar'; tipo: string }
  | { situacao: 'mover'; tipo: string }
  | { situacao: 'classificar' }
  | { situacao: 'ignorar' };

/** Texto sem acento, minúsculo, espaços colapsados — para comparar nomes. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Decide o que fazer com um arquivo a partir do caminho relativo à pasta do cliente. */
export function classificarCaminho(relativo: string): Situacao {
  const partes = relativo.split(/[\\/]+/).filter(Boolean);
  const arquivo = partes[partes.length - 1];
  const pasta = partes.length > 1 ? partes[0] : null;
  const ext = extname(arquivo).toLowerCase();
  const nomeBase = normalizar(basename(arquivo, extname(arquivo)));

  if (ARQUIVOS_IGNORADOS.includes(normalizar(arquivo))) return { situacao: 'ignorar' };
  if (pasta && PASTAS_INTERNAS.some((p) => normalizar(p) === normalizar(pasta))) return { situacao: 'ignorar' };

  const doc = DOCUMENTOS_PADRAO.find(
    (d) => normalizar(d.nome) === nomeBase && (d.extensoes.length === 0 || d.extensoes.includes(ext)),
  );
  const tipo = doc?.nome ?? (ehAudio(arquivo) ? 'Áudio da ligação' : ehTranscricao(arquivo) ? 'Transcrição' : null);
  if (!tipo) return { situacao: 'classificar' };

  const destino = DOCUMENTOS_PADRAO.find((d) => d.nome === tipo)!;
  const noLugar = partes.length === 2 && normalizar(pasta!) === normalizar(destino.pasta) && doc !== undefined;
  return noLugar ? { situacao: 'no-lugar', tipo } : { situacao: 'mover', tipo };
}

/** Caminho final (relativo) de um tipo de documento. */
export function nomeFinal(tipo: string, ext: string): string {
  const doc = DOCUMENTOS_PADRAO.find((d) => d.nome === tipo);
  if (!doc) throw new Error(`Tipo desconhecido: ${tipo}`);
  return `${doc.pasta}/${doc.nome}${ext.toLowerCase()}`;
}

export function ehAudio(nome: string): boolean {
  return EXT_AUDIO.includes(extname(nome).toLowerCase());
}

/** Transcrição pronta da ligação: texto (txt/md/docx/pdf) com "transcri" no nome (Transcrição, transcricao, transcript…). */
export function ehTranscricao(nome: string): boolean {
  const doc = DOCUMENTOS_PADRAO.find((d) => d.nome === 'Transcrição')!;
  return doc.extensoes.includes(extname(nome).toLowerCase()) && normalizar(basename(nome, extname(nome))).includes('transcri');
}

export function ehImagem(nome: string): boolean {
  return EXT_IMAGEM.includes(extname(nome).toLowerCase());
}

export function ehPdf(nome: string): boolean {
  return extname(nome).toLowerCase() === '.pdf';
}
