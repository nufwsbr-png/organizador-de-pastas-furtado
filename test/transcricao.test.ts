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
