import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { createCanvas } from '@napi-rs/canvas';
import { Fila } from '../src/main/fila';
import { inventariar } from '../src/main/etapas/inventario';
import { etapaClassificar, montarItens, planejarMovimentos, type Classificacao, type PlanoMovimentos } from '../src/main/etapas/classificar';
import { etapaMover, aplicarPlano } from '../src/main/etapas/mover';
import { contarPaginas } from '../src/main/ferramentas/pdf';
import type { Contexto } from '../src/main/job';
import type { Pedido, Provedor } from '../src/main/provedores/tipos';

async function pdfTexto(destino: string, texto: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument();
    const s = doc.pipe(createWriteStream(destino));
    doc.text(texto);
    doc.end();
    s.on('finish', () => resolve());
    s.on('error', reject);
  });
}

function png(destino: string): void {
  const c = createCanvas(80, 40);
  c.getContext('2d').fillRect(0, 0, 80, 40);
  writeFileSync(destino, c.toBuffer('image/png'));
}

function provedorFalso(resposta: (p: Pedido) => unknown, pedidos: Pedido[] = []): Provedor {
  return {
    id: 'claude',
    nome: 'Falso',
    status: async () => ({ instalado: true, logado: true, conta: 'x', caminho: 'x' }),
    rodar: async (p) => {
      pedidos.push(p);
      return resposta(p);
    },
  };
}

/** Pasta desorganizada: documentos soltos, foto de RG frente/verso, áudio, perguntas e um arquivo desconhecido. */
async function pastaBaguncada() {
  const dir = mkdtempSync(join(tmpdir(), 'org-'));
  const cliente = join(dir, 'João da Silva');
  const pastaJob = join(dir, 'job');
  mkdirSync(join(cliente, 'Fotos'), { recursive: true });
  mkdirSync(pastaJob);
  await pdfTexto(join(cliente, 'doc (2).pdf'), 'PROCURAÇÃO AD JUDICIA ET EXTRA. Outorgante: João da Silva');
  await pdfTexto(join(cliente, 'declaracao hipossuficiencia.pdf'), 'DECLARAÇÃO DE HIPOSSUFICIÊNCIA');
  await pdfTexto(join(cliente, 'Contratos', 'Contrato Trabalhista.pdf').replace('Contratos', 'Fotos'), 'CONTRATO DE HONORÁRIOS');
  png(join(cliente, 'Fotos', 'WhatsApp Image 1.png'));
  png(join(cliente, 'Fotos', 'WhatsApp Image 2.png'));
  await pdfTexto(join(cliente, 'receita.pdf'), 'Receita médica');
  writeFileSync(join(cliente, 'ligacao.mp3'), 'ID3');
  await pdfTexto(join(cliente, 'Perguntas entrevista .pdf'), '01 Qual era o endereço?');
  writeFileSync(join(pastaJob, 'Entrevista preenchida.pdf'), '%PDF-fake');
  inventariar(cliente, join(pastaJob, 'inventario.json'));
  const fila = new Fila(join(dir, 'jobs.json'));
  const job = fila.adicionar(cliente);
  const mensagens: string[] = [];
  const ctx: Contexto = { fila, pastaJob, job, log: (t) => mensagens.push(t) };
  return { cliente, pastaJob, ctx, mensagens };
}

const classificacaoFalsa = (p: Pedido): { arquivos: Classificacao[] } => {
  const ids = [...p.prompt.matchAll(/\[id: (\d+)\] (.+)/g)].map((m) => ({ id: Number(m[1]), nome: m[2].trim() }));
  const porNome = (parte: string) => ids.find((i) => i.nome.includes(parte))!.id;
  return {
    arquivos: [
      { id: porNome('doc (2).pdf'), tipo: 'Procuração', grupo: null, ordem: 1 },
      { id: porNome('declaracao'), tipo: 'Declaração', grupo: null, ordem: 1 },
      { id: porNome('WhatsApp Image 1'), tipo: 'RG', grupo: 'rg', ordem: 1 },
      { id: porNome('WhatsApp Image 2'), tipo: 'RG', grupo: 'rg', ordem: 2 },
      { id: porNome('receita'), tipo: 'outro', grupo: null, ordem: 1 },
    ],
  };
};

describe('etapaClassificar', () => {
  it('manda só o que precisa de classificação para a IA, com texto ou imagens, e grava o plano', async () => {
    const { ctx, pastaJob } = await pastaBaguncada();
    const pedidos: Pedido[] = [];
    const r = await etapaClassificar(() => provedorFalso(classificacaoFalsa, pedidos)).executar(ctx);
    expect(r.status).toBe('ok');
    expect(pedidos).toHaveLength(1);
    const prompt = pedidos[0].prompt;
    expect(prompt).toContain('doc (2).pdf');
    expect(prompt).toContain('PROCURAÇÃO AD JUDICIA');
    expect(prompt).not.toContain('ligacao.mp3');
    expect(prompt).not.toMatch(/\[id: \d+\] Perguntas entrevista/);
    expect(pedidos[0].imagens.filter((i) => i.includes('WhatsApp Image')).length).toBe(2);
    const plano = JSON.parse(readFileSync(join(pastaJob, 'plano-movimentos.json'), 'utf8')) as PlanoMovimentos;
    expect(plano.movimentos.find((m) => m.origem === 'doc (2).pdf')?.destino).toBe('Contratos/Procuração.pdf');
    expect(plano.movimentos.find((m) => m.origem === 'ligacao.mp3')?.destino).toBe('Entrevista/Áudio da ligação.mp3');
    expect(plano.movimentos.find((m) => m.origem === 'Fotos/Contrato Trabalhista.pdf')?.destino).toBe('Não juntar/Contrato Trabalhista.pdf');
    expect(plano.movimentos.find((m) => m.origem === 'Perguntas entrevista .pdf')?.destino).toBe('Entrevista/Perguntas entrevista.pdf');
    expect(plano.movimentos.find((m) => m.origem === 'receita.pdf')?.destino).toBe('Revisar/receita.pdf');
    const rg = plano.juntarImagens.find((j) => j.destino === 'Documentos/RG.pdf');
    expect(rg?.origens).toEqual(['Fotos/WhatsApp Image 1.png', 'Fotos/WhatsApp Image 2.png']);
  });

  it('sem nada para classificar não chama a IA', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'org-'));
    const cliente = join(dir, 'Ana');
    mkdirSync(join(cliente, 'Contratos'), { recursive: true });
    await pdfTexto(join(cliente, 'Contratos', 'Procuração.pdf'), 'x');
    const pastaJob = join(dir, 'job');
    mkdirSync(pastaJob);
    inventariar(cliente, join(pastaJob, 'inventario.json'));
    const fila = new Fila(join(dir, 'jobs.json'));
    const job = fila.adicionar(cliente);
    const pedidos: Pedido[] = [];
    const r = await etapaClassificar(() => provedorFalso(classificacaoFalsa, pedidos)).executar({ fila, pastaJob, job, log: () => {} });
    expect(r.status).toBe('ok');
    expect(pedidos).toHaveLength(0);
  });

  it('duas transcrições ficam as duas na Entrevista, numeradas em ordem de horário', () => {
    const plano = planejarMovimentos(
      [
        { relativo: 'Transcricao - 19-10-2026 - 16h56 - G.txt', situacao: 'mover', tipo: 'Transcrição', tamanho: 1, modificadoEm: '' },
        { relativo: 'Transcricao - 19-10-2026 - 16h45 - G.txt', situacao: 'mover', tipo: 'Transcrição', tamanho: 1, modificadoEm: '' },
      ],
      [],
      {},
      false,
    );
    expect(plano.movimentos.map((m) => [m.origem, m.destino])).toEqual([
      ['Transcricao - 19-10-2026 - 16h56 - G.txt', 'Entrevista/Transcrição 2.txt'],
      ['Transcricao - 19-10-2026 - 16h45 - G.txt', 'Entrevista/Transcrição.txt'],
    ]);
  });

  it('dois arquivos classificados com o mesmo tipo: o segundo vai para Revisar', () => {
    const plano = planejarMovimentos(
      [
        { relativo: 'a.pdf', situacao: 'classificar', tamanho: 1, modificadoEm: '' },
        { relativo: 'b.pdf', situacao: 'classificar', tamanho: 1, modificadoEm: '' },
      ],
      [
        { id: 0, tipo: 'RG', grupo: null, ordem: 1 },
        { id: 1, tipo: 'RG', grupo: null, ordem: 1 },
      ],
      { 0: 'a.pdf', 1: 'b.pdf' },
      true,
    );
    expect(plano.movimentos.map((m) => m.destino)).toEqual(['Documentos/RG.pdf', 'Revisar/b.pdf']);
  });

  it('montarItens descreve cada arquivo com id, nome, texto ou imagens', () => {
    const itens = montarItens([
      { id: 0, relativo: 'x.pdf', texto: 'PROCURAÇÃO', imagens: [] },
      { id: 1, relativo: 'y.png', texto: '', imagens: ['C:\\tmp\\y.png'] },
    ]);
    expect(itens).toContain('[id: 0] x.pdf');
    expect(itens).toContain('PROCURAÇÃO');
    expect(itens).toContain('[id: 1] y.png');
    expect(itens).toContain('C:\\tmp\\y.png');
  });
});

describe('etapaMover', () => {
  it('aplica o plano: move, renomeia, junta imagens em PDF, cria Entrevista e Revisar, nunca apaga', async () => {
    const { ctx, cliente, pastaJob } = await pastaBaguncada();
    await etapaClassificar(() => provedorFalso(classificacaoFalsa)).executar(ctx);
    const r = await etapaMover().executar(ctx);
    expect(r.status).toBe('ok');
    expect(existsSync(join(cliente, 'Contratos', 'Procuração.pdf'))).toBe(true);
    expect(existsSync(join(cliente, 'Contratos', 'Declaração.pdf'))).toBe(true);
    expect(existsSync(join(cliente, 'Não juntar', 'Contrato Trabalhista.pdf'))).toBe(true);
    expect(existsSync(join(cliente, 'Documentos', 'RG.pdf'))).toBe(true);
    expect(await contarPaginas(join(cliente, 'Documentos', 'RG.pdf'))).toBe(2);
    expect(existsSync(join(cliente, 'Entrevista', 'Áudio da ligação.mp3'))).toBe(true);
    expect(existsSync(join(cliente, 'Entrevista', 'Perguntas entrevista.pdf'))).toBe(true);
    expect(existsSync(join(cliente, 'Entrevista', 'Entrevista preenchida.pdf'))).toBe(true);
    expect(existsSync(join(cliente, 'Revisar', 'receita.pdf'))).toBe(true);
    // as fotos originais do RG viram PDF; os arquivos originais vão para _substituidos (nunca apagados)
    expect(existsSync(join(cliente, 'Fotos', 'WhatsApp Image 1.png'))).toBe(false);
    expect(existsSync(join(cliente, '_substituidos', 'Fotos', 'WhatsApp Image 1.png'))).toBe(true);
    expect(existsSync(join(cliente, 'doc (2).pdf'))).toBe(false);
    expect(readdirSync(join(cliente, 'Fotos'))).toEqual([]);
    const log = JSON.parse(readFileSync(join(pastaJob, 'movimentos.json'), 'utf8')) as { feitos: unknown[] };
    expect(log.feitos.length).toBeGreaterThan(5);
  });

  it('sobrescrever um arquivo existente guarda o anterior em _substituidos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mv-'));
    mkdirSync(join(dir, 'Contratos'), { recursive: true });
    writeFileSync(join(dir, 'Contratos', 'Procuração.pdf'), 'velho');
    writeFileSync(join(dir, 'nova.pdf'), 'novo');
    aplicarPlano(dir, { movimentos: [{ origem: 'nova.pdf', destino: 'Contratos/Procuração.pdf', tipo: 'Procuração' }], juntarImagens: [], copiarDoJob: [] }, '', () => {});
    expect(readFileSync(join(dir, 'Contratos', 'Procuração.pdf'), 'utf8')).toBe('novo');
    expect(readFileSync(join(dir, '_substituidos', 'Contratos', 'Procuração.pdf'), 'utf8')).toBe('velho');
  });

  it('rodar duas vezes não quebra (idempotente)', async () => {
    const { ctx, cliente } = await pastaBaguncada();
    await etapaClassificar(() => provedorFalso(classificacaoFalsa)).executar(ctx);
    await etapaMover().executar(ctx);
    const r = await etapaMover().executar(ctx);
    expect(r.status).toBe('ok');
    expect(existsSync(join(cliente, 'Contratos', 'Procuração.pdf'))).toBe(true);
  });
});

describe('casos da revisão', () => {
  it('dois arquivos com o mesmo nome em pastas diferentes não colidem em Revisar', () => {
    const plano = planejarMovimentos(
      [
        { relativo: 'Fotos/doc (1).pdf', situacao: 'classificar', tamanho: 1, modificadoEm: '' },
        { relativo: 'Scan/doc (1).pdf', situacao: 'classificar', tamanho: 1, modificadoEm: '' },
      ],
      [
        { id: 0, tipo: 'outro', grupo: null, ordem: 1 },
        { id: 1, tipo: 'outro', grupo: null, ordem: 1 },
      ],
      { 0: 'Fotos/doc (1).pdf', 1: 'Scan/doc (1).pdf' },
      false,
    );
    const destinos = plano.movimentos.map((m) => m.destino);
    expect(new Set(destinos).size).toBe(2);
    expect(destinos.every((d) => d.startsWith('Revisar/'))).toBe(true);
  });

  it('classificar manda a pasta do job como pasta extra de leitura (PNGs dos PDFs digitalizados)', async () => {
    const { ctx, pastaJob } = await pastaBaguncada();
    const pedidos: Pedido[] = [];
    await etapaClassificar(() => provedorFalso(classificacaoFalsa, pedidos)).executar(ctx);
    expect(pedidos[0].dirsExtras).toEqual([pastaJob]);
  });
});
