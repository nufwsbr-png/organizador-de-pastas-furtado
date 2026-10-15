import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Fila } from '../src/main/fila';
import { executarJob, ErroPausa, type Etapa, type Contexto } from '../src/main/job';

function preparar() {
  const dir = mkdtempSync(join(tmpdir(), 'job-'));
  const fila = new Fila(join(dir, 'jobs.json'));
  const job = fila.adicionar(join(dir, 'Cliente'));
  const pastaJob = join(dir, 'jobs', job.id);
  return { dir, fila, job, pastaJob };
}

type Saida = void | { pendente: string } | { pulada: string };

function etapa(nome: string, saida: string, fn: (ctx: Contexto) => Promise<Saida>, dependeDe: string[] = []): Etapa {
  return {
    nome,
    saida,
    dependeDe,
    executar: async (ctx) => {
      const r = await fn(ctx);
      if (r && 'pendente' in r) return { status: 'pendente', motivo: r.pendente };
      if (r && 'pulada' in r) return { status: 'pulada', motivo: r.pulada };
      writeFileSync(join(ctx.pastaJob, saida), 'ok');
      return { status: 'ok' };
    },
  };
}

describe('executarJob', () => {
  it('roda as etapas em ordem, grava a saída e conclui', async () => {
    const { fila, job, pastaJob } = preparar();
    const ordem: string[] = [];
    const etapas = [
      etapa('a', 'a.txt', async () => {
        ordem.push('a');
      }),
      etapa('b', 'b.txt', async () => {
        ordem.push('b');
      }),
    ];
    await executarJob(job.id, etapas, { fila, pastaJob });
    expect(ordem).toEqual(['a', 'b']);
    expect(existsSync(join(pastaJob, 'a.txt'))).toBe(true);
    const atual = fila.obter(job.id)!;
    expect(atual.estado).toBe('concluido');
    expect(atual.etapasConcluidas).toEqual(['a', 'b']);
  });

  it('pula etapa cuja saída já existe (retomada)', async () => {
    const { fila, job, pastaJob } = preparar();
    const ordem: string[] = [];
    const etapas = [
      etapa('a', 'a.txt', async () => {
        ordem.push('a');
      }),
      etapa('b', 'b.txt', async () => {
        ordem.push('b');
      }),
    ];
    await executarJob(job.id, etapas, { fila, pastaJob });
    ordem.length = 0;
    fila.atualizar(job.id, { estado: 'na-fila', etapasConcluidas: [] });
    await executarJob(job.id, etapas, { fila, pastaJob });
    expect(ordem).toEqual([]);
    expect(fila.obter(job.id)!.estado).toBe('concluido');
  });

  it('etapa pendente deixa as dependentes pendentes, as outras seguem, e o job fica em atenção', async () => {
    const { fila, job, pastaJob } = preparar();
    const ordem: string[] = [];
    const etapas = [
      etapa('transcricao', 't.txt', async () => ({ pendente: 'precisa da API' })),
      etapa(
        'respostas',
        'r.json',
        async () => {
          ordem.push('respostas');
        },
        ['transcricao'],
      ),
      etapa('mover', 'm.json', async () => {
        ordem.push('mover');
      }),
    ];
    await executarJob(job.id, etapas, { fila, pastaJob });
    expect(ordem).toEqual(['mover']);
    const atual = fila.obter(job.id)!;
    expect(atual.estado).toBe('atencao');
    expect(atual.etapasPendentes).toEqual(['transcricao', 'respostas']);
    expect(atual.motivo).toContain('precisa da API');
  });

  it('erro de pausa (limite/API) deixa o job pausado com o motivo', async () => {
    const { fila, job, pastaJob } = preparar();
    const etapas = [
      etapa('a', 'a.txt', async () => {
        throw new ErroPausa('Limite da assinatura');
      }),
    ];
    await executarJob(job.id, etapas, { fila, pastaJob });
    const atual = fila.obter(job.id)!;
    expect(atual.estado).toBe('pausado');
    expect(atual.motivo).toBe('Limite da assinatura');
  });

  it('erro comum deixa o job em erro e guarda a mensagem', async () => {
    const { fila, job, pastaJob } = preparar();
    const etapas = [
      etapa('a', 'a.txt', async () => {
        throw new Error('explodiu');
      }),
    ];
    await executarJob(job.id, etapas, { fila, pastaJob });
    const atual = fila.obter(job.id)!;
    expect(atual.estado).toBe('erro');
    expect(atual.motivo).toBe('explodiu');
    expect(atual.mensagens.some((m) => m.nivel === 'erro')).toBe(true);
  });
});
