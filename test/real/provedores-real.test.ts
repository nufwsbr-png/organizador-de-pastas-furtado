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
