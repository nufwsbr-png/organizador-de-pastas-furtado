// Pipeline completo numa CÓPIA da pasta real da Elisângela. Só roda com TESTE_REAL=1 (usa a assinatura e, se houver, a chave do ElevenLabs).
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '../../src/main/config';
import { etapaClassificar } from '../../src/main/etapas/classificar';
import { etapaEntregarEntrevista } from '../../src/main/etapas/entregar-entrevista';
import { inventariar } from '../../src/main/etapas/inventario';
import { etapaMover } from '../../src/main/etapas/mover';
import { etapaPdfEntrevista } from '../../src/main/etapas/pdf-entrevista';
import { etapaPerguntas } from '../../src/main/etapas/perguntas';
import { etapaRespostas } from '../../src/main/etapas/respostas';
import { etapaTranscricao } from '../../src/main/etapas/transcricao';
import { transcreverElevenLabs } from '../../src/main/ferramentas/elevenlabs';
import type { Etapa } from '../../src/main/job';
import { Orquestrador } from '../../src/main/orquestrador';
import { ProvedorClaude } from '../../src/main/provedores/claude';
import { ProvedorCodex } from '../../src/main/provedores/codex';
import { localizarExecutavel } from '../../src/main/provedores/localizar';
import type { Provedor } from '../../src/main/provedores/tipos';

const REAL = process.env.TESTE_REAL === '1';
const ORIGEM = process.env.PASTA_ORIGEM ?? 'C:\\Users\\Computador08\\Downloads\\Elisângela Cristina Mariano';
const PROVEDOR = (process.env.PROVEDOR ?? 'claude') as 'claude' | 'codex';
const DESTINO = process.env.PASTA_DESTINO;

describe.skipIf(!REAL || !existsSync(ORIGEM))('pipeline real', () => {
  it('organiza uma cópia da pasta da Elisângela', async () => {
    const base = DESTINO ?? mkdtempSync(join(tmpdir(), 'pipeline-'));
    const cliente = join(base, 'Elisângela Cristina Mariano');
    if (existsSync(cliente)) rmSync(cliente, { recursive: true, force: true });
    cpSync(ORIGEM, cliente, { recursive: true });
    console.log('cópia em', cliente);

    const config = new Config(join(base, 'userData'), [join(process.cwd(), '.env')]);
    const exe = localizarExecutavel(PROVEDOR)!;
    const provedor = (): Provedor =>
      PROVEDOR === 'claude' ? new ProvedorClaude({ executavel: exe, timeoutMs: 25 * 60_000 }) : new ProvedorCodex({ executavel: exe, timeoutMs: 25 * 60_000 });
    const etapas = (): Etapa[] => [
      {
        nome: 'inventario',
        saida: 'inventario.json',
        async executar(ctx) {
          inventariar(ctx.job.pasta, join(ctx.pastaJob, 'inventario.json'));
          return { status: 'ok' };
        },
      },
      etapaTranscricao({ chave: () => config.chaveElevenLabs(), transcrever: (a, k) => transcreverElevenLabs(a, k) }),
      etapaPerguntas(provedor),
      etapaRespostas(provedor),
      etapaPdfEntrevista(),
      etapaClassificar(provedor),
      etapaMover(),
      etapaEntregarEntrevista(),
    ];
    const orq = new Orquestrador({ userData: join(base, 'userData'), paralelismo: () => 1, etapas });
    const job = orq.adicionarPasta(cliente);
    const inicio = Date.now();
    await orq.organizar(job.id);
    const final = orq.jobs()[0];
    console.log('estado:', final.estado, '| motivo:', final.motivo, '| min:', ((Date.now() - inicio) / 60000).toFixed(1));
    for (const m of final.mensagens) console.log(`  [${m.nivel}] ${m.texto}`);
    const listar = (dir: string, prefixo = ''): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listar(join(dir, e.name), `${prefixo}${e.name}/`) : [`${prefixo}${e.name}`]));
    console.log('ÁRVORE FINAL:\n  ' + listar(cliente).join('\n  '));
    const perguntas = join(orq.pastaJob(job.id), 'perguntas.json');
    if (existsSync(perguntas)) {
      const lista = JSON.parse(readFileSync(perguntas, 'utf8')) as { numero: number; pergunta: string; simNao: boolean }[];
      console.log(`PERGUNTAS (${lista.length}):\n  ` + lista.map((p) => `${p.numero}. ${p.pergunta}${p.simNao ? ' [S/N]' : ''}`).join('\n  '));
      expect(lista.length).toBe(23);
    }
    expect(['concluido', 'atencao']).toContain(final.estado);
    expect(existsSync(join(cliente, 'Entrevista', 'Perguntas entrevista.pdf'))).toBe(true);
    expect(existsSync(join(cliente, 'Entrevista', 'Áudio da ligação.wav'))).toBe(true);
    expect(existsSync(join(cliente, 'Contratos', 'Procuração.pdf'))).toBe(true);
  }, 40 * 60_000);
});
