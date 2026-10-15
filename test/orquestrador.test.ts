import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Orquestrador } from '../src/main/orquestrador';
import type { Etapa } from '../src/main/job';

function etapaLenta(nome: string, ms: number, registro: { ativos: number; pico: number; ordem: string[] }): Etapa {
  return {
    nome,
    saida: `${nome}.txt`,
    async executar(ctx) {
      registro.ativos++;
      registro.pico = Math.max(registro.pico, registro.ativos);
      registro.ordem.push(`${ctx.job.nome}:${nome}`);
      await new Promise((r) => setTimeout(r, ms));
      writeFileSync(join(ctx.pastaJob, `${nome}.txt`), 'ok');
      registro.ativos--;
      return { status: 'ok' };
    },
  };
}

function pastas(n: number): { userData: string; clientes: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'orq-'));
  const clientes: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = join(dir, `Cliente ${i + 1}`);
    mkdirSync(c);
    clientes.push(c);
  }
  return { userData: join(dir, 'userData'), clientes };
}

describe('Orquestrador', () => {
  it('organiza várias pastas ao mesmo tempo respeitando o paralelismo', async () => {
    const { userData, clientes } = pastas(4);
    const registro = { ativos: 0, pico: 0, ordem: [] as string[] };
    const orq = new Orquestrador({ userData, paralelismo: () => 2, etapas: () => [etapaLenta('a', 30, registro)] });
    for (const c of clientes) orq.adicionarPasta(c);
    await orq.organizarTudo();
    expect(registro.pico).toBe(2);
    expect(orq.jobs().every((j) => j.estado === 'concluido')).toBe(true);
  });

  it('não roda o mesmo job duas vezes ao mesmo tempo', async () => {
    const { userData, clientes } = pastas(1);
    const registro = { ativos: 0, pico: 0, ordem: [] as string[] };
    const orq = new Orquestrador({ userData, paralelismo: () => 3, etapas: () => [etapaLenta('a', 30, registro)] });
    const job = orq.adicionarPasta(clientes[0]);
    await Promise.all([orq.organizar(job.id), orq.organizar(job.id), orq.organizar(job.id)]);
    expect(registro.ordem).toEqual(['Cliente 1:a']);
  });

  it('ao abrir de novo, retoma o que estava na fila sem refazer etapas prontas', async () => {
    const { userData, clientes } = pastas(1);
    const registro = { ativos: 0, pico: 0, ordem: [] as string[] };
    const etapas = () => [etapaLenta('a', 5, registro), etapaLenta('b', 5, registro)];
    const orq = new Orquestrador({ userData, paralelismo: () => 1, etapas });
    const job = orq.adicionarPasta(clientes[0]);
    // simula o app fechado depois da etapa "a": marca rodando e grava só a saída de "a"
    writeFileSync(join(orq.pastaJob(job.id), 'a.txt'), 'ok');
    orq.fila.atualizar(job.id, { estado: 'rodando', etapa: 'b' });

    const reaberto = new Orquestrador({ userData, paralelismo: () => 1, etapas });
    expect(reaberto.jobs()[0].estado).toBe('na-fila');
    await reaberto.retomarPendentes();
    expect(registro.ordem).toEqual(['Cliente 1:b']);
    expect(reaberto.jobs()[0].estado).toBe('concluido');
  });

  it('refazer apaga as saídas do job (menos a transcrição) e volta para a fila', async () => {
    const { userData, clientes } = pastas(1);
    const registro = { ativos: 0, pico: 0, ordem: [] as string[] };
    const orq = new Orquestrador({ userData, paralelismo: () => 1, etapas: () => [etapaLenta('a', 5, registro)] });
    const job = orq.adicionarPasta(clientes[0]);
    await orq.organizarTudo();
    writeFileSync(join(orq.pastaJob(job.id), 'transcricao.txt'), 'guardar');
    orq.refazer(job.id);
    expect(orq.jobs()[0].estado).toBe('na-fila');
    expect(orq.jobs()[0].etapasConcluidas).toEqual([]);
    await orq.organizarTudo();
    expect(registro.ordem).toEqual(['Cliente 1:a', 'Cliente 1:a']);
  });
});
