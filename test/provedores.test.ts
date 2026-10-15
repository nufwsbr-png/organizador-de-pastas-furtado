import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localizarExecutavel } from '../src/main/provedores/localizar';
import { ProvedorClaude, interpretarStatusClaude, montarArgsClaude } from '../src/main/provedores/claude';
import { ProvedorCodex, interpretarStatusCodex, montarArgsCodex } from '../src/main/provedores/codex';
import { ErroPausa } from '../src/main/job';

const FAKES = join(import.meta.dirname, 'fakes');

function temp(): string {
  return mkdtempSync(join(tmpdir(), 'prov-'));
}

const schema = { type: 'object', properties: { resposta: { type: 'string' } }, required: ['resposta'] };

describe('localizarExecutavel', () => {
  it('acha o executável nos candidatos e no PATH, nessa ordem', () => {
    const d = temp();
    mkdirSync(join(d, 'bin'));
    writeFileSync(join(d, 'bin', 'claude.exe'), '');
    const achado = localizarExecutavel('claude', { candidatos: [join(d, 'nao-existe', 'claude.exe'), join(d, 'bin', 'claude.exe')], path: '' });
    expect(achado).toBe(join(d, 'bin', 'claude.exe'));
    expect(localizarExecutavel('claude', { candidatos: [], path: '' })).toBeNull();
  });

  it('acha .cmd no PATH quando não há exe', () => {
    const d = temp();
    writeFileSync(join(d, 'codex.cmd'), '');
    expect(localizarExecutavel('codex', { candidatos: [], path: d })).toBe(join(d, 'codex.cmd'));
  });
});

describe('ProvedorClaude', () => {
  it('monta os argumentos do claude -p sem --bare (para usar a assinatura)', () => {
    const args = montarArgsClaude({ schema, cwd: 'C:\\x', imagens: [], prompt: 'oi', nomeTarefa: 't' });
    expect(args).toContain('-p');
    expect(args).not.toContain('--bare');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
    expect(args[args.indexOf('--json-schema') + 1]).toBe(JSON.stringify(schema));
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(args[args.indexOf('--add-dir') + 1]).toBe('C:\\x');
  });

  it('interpreta o status de login', () => {
    expect(interpretarStatusClaude('{"loggedIn":true,"email":"a@b.com","subscriptionType":"max"}')).toEqual({
      logado: true,
      conta: 'a@b.com (max)',
    });
    expect(interpretarStatusClaude('{"loggedIn":false}')).toEqual({ logado: false, conta: null });
    expect(interpretarStatusClaude('lixo')).toEqual({ logado: false, conta: null });
  });

  it('roda o executável, manda o prompt por stdin e devolve structured_output', async () => {
    const p = new ProvedorClaude({ executavel: process.execPath, argsPrefixo: [join(FAKES, 'claude-fake.mjs')] });
    const saida = await p.rodar({ prompt: 'qual a cor?', schema, cwd: temp(), imagens: [], nomeTarefa: 'teste' });
    expect(saida).toEqual({ resposta: 'ECO: qual a cor?' });
  });

  it('limite de uso vira ErroPausa; erro comum vira Error com a mensagem', async () => {
    const p = new ProvedorClaude({ executavel: process.execPath, argsPrefixo: [join(FAKES, 'claude-fake.mjs')] });
    await expect(p.rodar({ prompt: 'RATE_LIMIT', schema, cwd: temp(), imagens: [], nomeTarefa: 't' })).rejects.toBeInstanceOf(ErroPausa);
    await expect(p.rodar({ prompt: 'AUTH', schema, cwd: temp(), imagens: [], nomeTarefa: 't' })).rejects.toBeInstanceOf(ErroPausa);
    await expect(p.rodar({ prompt: 'ERRO', schema, cwd: temp(), imagens: [], nomeTarefa: 't' })).rejects.toThrow(/deu errado/);
  });
});

describe('ProvedorCodex', () => {
  it('monta os argumentos do codex exec com schema em arquivo e imagens', () => {
    const args = montarArgsCodex({ schema, cwd: 'C:\\x', imagens: ['C:\\x\\a.png'], prompt: 'oi', nomeTarefa: 't' }, 'C:\\tmp\\schema.json', 'C:\\tmp\\saida.json');
    expect(args.slice(0, 2)).toEqual(['exec', '-']);
    expect(args).toContain('--json');
    expect(args[args.indexOf('--output-schema') + 1]).toBe('C:\\tmp\\schema.json');
    expect(args[args.indexOf('-o') + 1]).toBe('C:\\tmp\\saida.json');
    expect(args[args.indexOf('-C') + 1]).toBe('C:\\x');
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(args).toContain('--skip-git-repo-check');
    expect(args[args.indexOf('-i') + 1]).toBe('C:\\x\\a.png');
  });

  it('interpreta o status de login', () => {
    expect(interpretarStatusCodex('Logged in using ChatGPT\n')).toEqual({ logado: true, conta: 'ChatGPT' });
    expect(interpretarStatusCodex('Logged in using API key\n')).toEqual({ logado: true, conta: 'API key' });
    expect(interpretarStatusCodex('Not logged in\n')).toEqual({ logado: false, conta: null });
  });

  it('roda o executável e lê o JSON gravado em -o', async () => {
    const p = new ProvedorCodex({ executavel: process.execPath, argsPrefixo: [join(FAKES, 'codex-fake.mjs')], pastaTemp: temp() });
    const saida = await p.rodar({ prompt: 'qual a cor?', schema, cwd: temp(), imagens: [], nomeTarefa: 'teste' });
    expect(saida).toEqual({ resposta: 'ECO: qual a cor?' });
  });

  it('erro de limite no JSONL vira ErroPausa', async () => {
    const p = new ProvedorCodex({ executavel: process.execPath, argsPrefixo: [join(FAKES, 'codex-fake.mjs')], pastaTemp: temp() });
    await expect(p.rodar({ prompt: 'RATE_LIMIT', schema, cwd: temp(), imagens: [], nomeTarefa: 't' })).rejects.toBeInstanceOf(ErroPausa);
  });
});
