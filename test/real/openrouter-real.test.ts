// Transcrição de verdade pelo OpenRouter. Só roda com TESTE_REAL=1, OPENROUTER_API_KEY no .env do projeto e
// PASTA_ORIGEM apontando para a pasta de um cliente com "Entrevista/Áudio da ligação.wav". Custa centavos.
// MODELO_OPENROUTER=<modelo> troca o modelo (padrão: Voxtral mini); SAIDA_TRANSCRICAO=<arquivo> guarda o
// texto para conferir (fora do projeto: é conversa de cliente).
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '../../src/main/config';
import { MODELO_PADRAO, partesDoAudio, testarChaveOpenRouter, transcreverOpenRouter } from '../../src/main/ferramentas/openrouter';

const REAL = process.env.TESTE_REAL === '1';
const CHAVE = REAL ? new Config(mkdtempSync(join(tmpdir(), 'openrouter-real-')), [join(process.cwd(), '.env')]).chaveOpenRouter() : null;
const AUDIO = join(process.env.PASTA_ORIGEM ?? '', 'Entrevista', 'Áudio da ligação.wav');
const MODELO = process.env.MODELO_OPENROUTER ?? MODELO_PADRAO;

/** Gasto total da chave até agora (US$), para medir o custo da transcrição. */
async function gastoDaChave(): Promise<number> {
  const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${CHAVE}` } });
  return ((await r.json()) as { data: { usage: number } }).data.usage;
}

describe.skipIf(!CHAVE)('OpenRouter real: chave', () => {
  it('a chave do .env é aceita', async () => {
    const r = await testarChaveOpenRouter(CHAVE!);
    console.log(r.mensagem);
    expect(r.ok).toBe(true);
  });
});

describe.skipIf(!CHAVE || !process.env.PASTA_ORIGEM || !existsSync(AUDIO))('OpenRouter real', () => {
  it('transcreve a ligação inteira em partes, em português, com o tempo crescendo até o fim', { timeout: 20 * 60_000 }, async () => {
    const partes = partesDoAudio(AUDIO, readFileSync(AUDIO));
    const antes = await gastoDaChave();
    const inicio = Date.now();
    const texto = await transcreverOpenRouter(AUDIO, CHAVE!, { modelo: MODELO });
    const segundos = (Date.now() - inicio) / 1000;
    // o gasto da chave demora alguns segundos para atualizar
    await new Promise((r) => setTimeout(r, 15_000));
    const custo = (await gastoDaChave()) - antes;
    const resumo = `${MODELO}: ${(statSync(AUDIO).size / 1024 / 1024).toFixed(1)} MB em ${partes.length} parte(s), ${segundos.toFixed(0)} s, US$ ${custo.toFixed(4)}`;
    if (process.env.SAIDA_TRANSCRICAO) writeFileSync(process.env.SAIDA_TRANSCRICAO, `${resumo}\n\n${texto}`);
    console.log(resumo);
    const tempos = texto
      .split('\n')
      .map((l) => /^\[(\d+):(\d\d)\]/.exec(l))
      .filter(Boolean)
      .map((m) => Number(m![1]) * 60 + Number(m![2]));
    expect(tempos.length).toBeGreaterThanOrEqual(partes.length);
    expect(tempos.every((t, i) => i === 0 || t >= tempos[i - 1])).toBe(true);
    expect(texto).toMatch(/\b(você|não|empresa|trabalh)/i);
  });
});
