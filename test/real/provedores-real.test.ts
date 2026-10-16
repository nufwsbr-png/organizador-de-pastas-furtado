// Teste de integração com os CLIs reais. Só roda com TESTE_REAL=1 (usa a assinatura).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localizarExecutavel } from '../../src/main/provedores/localizar';
import { ProvedorClaude } from '../../src/main/provedores/claude';
import { ProvedorCodex } from '../../src/main/provedores/codex';

const REAL = process.env.TESTE_REAL === '1';
const schema = {
  type: 'object',
  properties: { capital: { type: 'string' }, confianca: { type: 'number' } },
  required: ['capital', 'confianca'],
  additionalProperties: false,
};

describe.skipIf(!REAL)('provedores reais', () => {
  it('claude: status e tarefa trivial com schema', async () => {
    const exe = localizarExecutavel('claude');
    expect(exe).not.toBeNull();
    const p = new ProvedorClaude({ executavel: exe!, timeoutMs: 180_000 });
    const st = await p.status();
    console.log('claude status', st);
    expect(st.logado).toBe(true);
    const r = (await p.rodar({ prompt: 'Qual é a capital do Brasil? Responda só no formato pedido.', schema, imagens: [], cwd: mkdtempSync(join(tmpdir(), 'c-')), nomeTarefa: 'capital' })) as { capital: string };
    console.log('claude resposta', r);
    expect(r.capital.toLowerCase()).toContain('bras');
  }, 200_000);

  it('codex: status e tarefa trivial com schema', async () => {
    const exe = localizarExecutavel('codex');
    expect(exe).not.toBeNull();
    const p = new ProvedorCodex({ executavel: exe!, timeoutMs: 180_000 });
    const st = await p.status();
    console.log('codex status', st);
    expect(st.logado).toBe(true);
    const r = (await p.rodar({ prompt: 'Qual é a capital do Brasil? Responda só no formato pedido.', schema, imagens: [], cwd: mkdtempSync(join(tmpdir(), 'c-')), nomeTarefa: 'capital' })) as { capital: string };
    console.log('codex resposta', r);
    expect(r.capital.toLowerCase()).toContain('bras');
  }, 200_000);
});

describe.skipIf(!REAL)('codex aceita os esquemas do app (modo estrito)', () => {
  it('perguntas, respostas e classificar', async () => {
    const { SCHEMA_PERGUNTAS } = await import('../../src/main/etapas/perguntas');
    const { SCHEMA_RESPOSTAS } = await import('../../src/main/etapas/respostas');
    const { SCHEMA_CLASSIFICAR } = await import('../../src/main/etapas/classificar');
    const exe = localizarExecutavel('codex');
    const p = new ProvedorCodex({ executavel: exe!, timeoutMs: 180_000 });
    const cwd = mkdtempSync(join(tmpdir(), 'c-'));
    const a = (await p.rodar({ prompt: 'Invente 2 perguntas de entrevista trabalhista, numeradas 1 e 2, seção "Geral". Não há dados do cliente.', schema: SCHEMA_PERGUNTAS, imagens: [], cwd, nomeTarefa: 'perguntas' })) as { perguntas: unknown[] };
    console.log('perguntas', JSON.stringify(a));
    expect(a.perguntas).toHaveLength(2);
    const b = (await p.rodar({ prompt: 'Responda: 1. Trabalhou aos sábados? (Sim/Não) — a cliente disse que sim. 2. Qual o salário? — não abordado.', schema: SCHEMA_RESPOSTAS, imagens: [], cwd, nomeTarefa: 'respostas' })) as { respostas: unknown[] };
    console.log('respostas', JSON.stringify(b));
    expect(b.respostas).toHaveLength(2);
    const c = (await p.rodar({ prompt: 'Classifique: [id: 1] rg-frente.jpg (foto de um RG, frente). [id: 2] procuracao.pdf.', schema: SCHEMA_CLASSIFICAR, imagens: [], cwd, nomeTarefa: 'classificar' })) as { arquivos: unknown[] };
    console.log('classificar', JSON.stringify(c));
    expect(c.arquivos).toHaveLength(2);
  }, 400_000);
});
