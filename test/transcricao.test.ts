import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Fila } from '../src/main/fila';
import { inventariar } from '../src/main/etapas/inventario';
import { etapaTranscricao, MENSAGEM_SEM_TRANSCRICAO } from '../src/main/etapas/transcricao';
import type { Contexto } from '../src/main/job';

function preparar(opcoes: { audio?: boolean; txt?: string; chave?: string | null; transcrever?: (arquivo: string, chave: string) => Promise<string> }) {
  const dir = mkdtempSync(join(tmpdir(), 'tr-'));
  const cliente = join(dir, 'Cliente');
  const pastaJob = join(dir, 'job');
  mkdirSync(cliente, { recursive: true });
  mkdirSync(pastaJob, { recursive: true });
  if (opcoes.audio !== false) writeFileSync(join(cliente, 'Áudio da ligação.wav'), 'RIFF');
  if (opcoes.txt) writeFileSync(join(cliente, 'Transcrição.txt'), opcoes.txt);
  inventariar(cliente, join(pastaJob, 'inventario.json'));
  const fila = new Fila(join(dir, 'jobs.json'));
  const job = fila.adicionar(cliente);
  const mensagens: string[] = [];
  const ctx: Contexto = { fila, pastaJob, job, log: (t) => mensagens.push(t) };
  const chamadas: string[] = [];
  const etapa = etapaTranscricao({
    chave: () => opcoes.chave ?? null,
    transcrever:
      opcoes.transcrever ??
      (async (arquivo) => {
        chamadas.push(arquivo);
        return `TRANSCRIÇÃO DE ${arquivo}`;
      }),
  });
  return { cliente, pastaJob, ctx, etapa, mensagens, chamadas };
}


describe('etapaTranscricao', () => {
  it('usa Transcrição.txt da pasta quando existe, sem chamar a API', async () => {
    const { ctx, etapa, pastaJob, chamadas } = preparar({ txt: 'texto pronto', chave: 'abc' });
    const r = await etapa.executar(ctx);
    expect(r.status).toBe('ok');
    expect(chamadas).toEqual([]);
    expect(readFileSync(join(pastaJob, 'transcricao.txt'), 'utf8')).toBe('texto pronto');
  });

  it('sem chave e sem txt fica pendente com a mensagem combinada', async () => {
    const { ctx, etapa, pastaJob } = preparar({ chave: null });
    const r = await etapa.executar(ctx);
    expect(r).toEqual({ status: 'pendente', motivo: MENSAGEM_SEM_TRANSCRICAO });
    expect(MENSAGEM_SEM_TRANSCRICAO).toContain('precisa da transcrição');
    expect(existsSync(join(pastaJob, 'transcricao.txt'))).toBe(false);
  });

  it('com chave transcreve cada áudio e grava transcricao.txt', async () => {
    const { ctx, etapa, pastaJob, chamadas, cliente, mensagens } = preparar({ chave: 'abc' });
    const r = await etapa.executar(ctx);
    expect(r.status).toBe('ok');
    expect(chamadas).toEqual([join(cliente, 'Áudio da ligação.wav')]);
    expect(readFileSync(join(pastaJob, 'transcricao.txt'), 'utf8')).toContain('TRANSCRIÇÃO DE');
    expect(mensagens.some((m) => m.includes('Transcrevendo'))).toBe(true);
  });

  it('sem áudio na pasta a etapa é pulada', async () => {
    const { ctx, etapa } = preparar({ audio: false, chave: 'abc' });
    const r = await etapa.executar(ctx);
    expect(r.status).toBe('pulada');
  });
});

describe('vários áudios', () => {
  it('guarda a transcrição de cada áudio; se o segundo falhar, o primeiro não é transcrito de novo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tr2-'));
    const cliente = join(dir, 'Cliente');
    const pastaJob = join(dir, 'job');
    mkdirSync(cliente); mkdirSync(pastaJob);
    writeFileSync(join(cliente, 'Áudio da ligação.wav'), 'RIFF');
    writeFileSync(join(cliente, 'ligacao 2.mp3'), 'ID3');
    inventariar(cliente, join(pastaJob, 'inventario.json'));
    const fila = new Fila(join(dir, 'jobs.json'));
    const job = fila.adicionar(cliente);
    const ctx: Contexto = { fila, pastaJob, job, log: () => {} };
    const chamadas: string[] = [];
    let falhar = true;
    const etapa = etapaTranscricao({
      chave: () => 'abc',
      transcrever: async (arquivo) => {
        chamadas.push(arquivo);
        if (falhar && arquivo.endsWith('.mp3')) throw new Error('429');
        return `T(${arquivo})`;
      },
    });
    await expect(etapa.executar(ctx)).rejects.toThrow('429');
    falhar = false;
    const r = await etapa.executar(ctx);
    expect(r.status).toBe('ok');
    expect(chamadas.filter((c) => c.endsWith('.wav'))).toHaveLength(1);
    const texto = readFileSync(join(pastaJob, 'transcricao.txt'), 'utf8');
    expect(texto).toContain('T(');
    expect(texto).toContain('ligacao 2.mp3');
  });
});

describe('transcrição pronta na pasta em outros formatos', () => {
  async function docx(destino: string, texto: string) {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    const paragrafos = texto.split('\n').map((l) => `<w:p><w:r><w:t xml:space="preserve">${l}</w:t></w:r></w:p>`).join('');
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragrafos}</w:body></w:document>`);
    writeFileSync(destino, await zip.generateAsync({ type: 'nodebuffer' }));
  }

  it('acha um .docx com "transcri" no nome em subpasta, lê o texto e não chama a API', async () => {
    const { cliente, ctx, etapa, pastaJob, chamadas } = preparar({ audio: true, chave: 'abc' });
    mkdirSync(join(cliente, 'Ligação'));
    await docx(join(cliente, 'Ligação', 'Transcricao da entrevista.docx'), 'Atendente: Bom dia.\nCliente: Bom dia, trabalhei na Acme.');
    inventariar(cliente, join(pastaJob, 'inventario.json'));
    const r = await etapa.executar(ctx);
    expect(r.status).toBe('ok');
    expect(chamadas).toEqual([]);
    const texto = readFileSync(join(pastaJob, 'transcricao.txt'), 'utf8');
    expect(texto).toContain('Atendente: Bom dia.');
    expect(texto).toContain('Cliente: Bom dia, trabalhei na Acme.');
  });

  it('acha um .pdf de transcrição e extrai o texto', async () => {
    const { cliente, ctx, etapa, pastaJob } = preparar({ audio: false });
    const PDFDocument = (await import('pdfkit')).default;
    const { createWriteStream } = await import('node:fs');
    await new Promise<void>((resolve) => {
      const doc = new PDFDocument();
      const s = doc.pipe(createWriteStream(join(cliente, 'Transcrição da ligação.pdf')));
      doc.text('Cliente: eu trabalhava das sete as cinco todos os dias.');
      doc.end();
      s.on('finish', () => resolve());
    });
    inventariar(cliente, join(pastaJob, 'inventario.json'));
    const r = await etapa.executar(ctx);
    expect(r.status).toBe('ok');
    expect(readFileSync(join(pastaJob, 'transcricao.txt'), 'utf8')).toContain('sete as cinco');
  });

  it('sem áudio mas com transcrição em txt com outro nome a entrevista segue', async () => {
    const { cliente, ctx, etapa, pastaJob } = preparar({ audio: false });
    writeFileSync(join(cliente, 'transcript ligacao.txt'), 'Cliente: sim, fazia hora extra.');
    inventariar(cliente, join(pastaJob, 'inventario.json'));
    const r = await etapa.executar(ctx);
    expect(r.status).toBe('ok');
    expect(readFileSync(join(pastaJob, 'transcricao.txt'), 'utf8')).toBe('Cliente: sim, fazia hora extra.');
  });
});

describe('ligação que caiu e continuou em outra chamada', () => {
  it('usa todas as transcrições da pasta, em ordem de horário, sem chamar a API', async () => {
    const { cliente, ctx, etapa, pastaJob, chamadas, mensagens } = preparar({ audio: false, chave: 'abc' });
    writeFileSync(join(cliente, 'Transcricao - 19-10-2026 - 16h56 - Gustavo.txt'), 'segunda parte');
    writeFileSync(join(cliente, 'Transcricao - 19-10-2026 - 16h45 - Gustavo.txt'), 'primeira parte');
    inventariar(cliente, join(pastaJob, 'inventario.json'));
    const r = await etapa.executar(ctx);
    expect(r.status).toBe('ok');
    expect(chamadas).toEqual([]);
    const texto = readFileSync(join(pastaJob, 'transcricao.txt'), 'utf8');
    expect(texto.indexOf('primeira parte')).toBeGreaterThan(-1);
    expect(texto.indexOf('primeira parte')).toBeLessThan(texto.indexOf('segunda parte'));
    expect(mensagens.join('\n')).toContain('2 transcrições');
  });

  it('a mesma ligação em txt e pdf conta uma vez (fica o txt)', async () => {
    const { cliente, ctx, etapa, pastaJob } = preparar({ audio: false });
    writeFileSync(join(cliente, 'Transcrição.txt'), 'do txt');
    writeFileSync(join(cliente, 'Transcrição.md'), 'do md');
    inventariar(cliente, join(pastaJob, 'inventario.json'));
    await etapa.executar(ctx);
    expect(readFileSync(join(pastaJob, 'transcricao.txt'), 'utf8')).toBe('do txt');
  });
});
