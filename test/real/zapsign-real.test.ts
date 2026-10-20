// ZapSign de verdade (só leitura). Só roda com TESTE_REAL=1 e ZAPSIGN_API_TOKEN no .env do projeto.
// Copia a pasta da Elisângela SEM os três assinados, roda a etapa e confere byte a byte com os originais.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '../../src/main/config';
import { inventariar } from '../../src/main/etapas/inventario';
import { etapaZapsign } from '../../src/main/etapas/zapsign';
import { ClienteZapsign } from '../../src/main/ferramentas/zapsign';
import { Fila } from '../../src/main/fila';

const REAL = process.env.TESTE_REAL === '1';
const ORIGEM = process.env.PASTA_ORIGEM ?? 'C:\\Users\\Computador08\\Downloads\\Elisângela Cristina Mariano';
const ASSINADOS = ['Contratos/Procuração.pdf', 'Contratos/Declaração.pdf', 'Não juntar/Contrato Trabalhista.pdf'];

describe.skipIf(!REAL || !existsSync(ORIGEM))('ZapSign real', () => {
  it('acha o envelope da Elisângela e baixa os três assinados iguais aos originais', async () => {
    const base = mkdtempSync(join(tmpdir(), 'zapsign-real-'));
    const cliente = join(base, 'Elisângela Cristina Mariano');
    cpSync(ORIGEM, cliente, { recursive: true });
    for (const rel of ASSINADOS) rmSync(join(cliente, rel));
    const pastaJob = join(base, 'job');
    inventariar(cliente, join(pastaJob, 'inventario.json'));

    const config = new Config(join(base, 'userData'), [join(process.cwd(), '.env')]);
    expect(config.tokenZapsign()).toBeTruthy();
    const linhas: string[] = [];
    const z = new ClienteZapsign({ token: () => config.tokenZapsign(), arquivoIndice: join(base, 'zapsign-indice.json'), log: (t) => linhas.push(t) });
    console.log(await z.testar());

    const inicio = Date.now();
    const fila = new Fila(join(base, 'jobs.json'));
    const job = fila.adicionar(cliente);
    const mensagens: string[] = [];
    const r = await etapaZapsign(() => z).executar({ fila, pastaJob, job, log: (t) => void mensagens.push(t) });
    console.log(`etapa em ${Date.now() - inicio} ms\n${[...linhas, ...mensagens].join('\n')}`);

    expect(r).toEqual({ status: 'ok' });
    for (const rel of ASSINADOS) expect(readFileSync(join(cliente, rel)).equals(readFileSync(join(ORIGEM, rel)))).toBe(true);

    // segunda pasta logo em seguida: o índice já está pronto, a busca é local
    const inicio2 = Date.now();
    await z.buscarPorNome('Elisângela Cristina Mariano');
    console.log(`segunda busca em ${Date.now() - inicio2} ms`);
    expect(Date.now() - inicio2).toBeLessThan(1000);

    // app reaberto: só lê o que entrou desde a última sincronização
    const reaberto = new ClienteZapsign({ token: () => config.tokenZapsign(), arquivoIndice: join(base, 'zapsign-indice.json'), frescorMs: 0, log: (t) => linhas.push(t) });
    const inicio3 = Date.now();
    await reaberto.sincronizar();
    console.log(`sincronização incremental em ${Date.now() - inicio3} ms — ${linhas.at(-1)}`);
    expect(Date.now() - inicio3).toBeLessThan(10_000);
  }, 300_000);
});
