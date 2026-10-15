import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '../src/main/config';

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'config-'));
}

describe('Config', () => {
  it('começa com os padrões e grava mudanças em settings.json', () => {
    const d = dir();
    const cfg = new Config(d);
    expect(cfg.obter().provedor).toBeNull();
    expect(cfg.obter().paralelismo).toBe(3);
    cfg.definir({ provedor: 'claude', paralelismo: 2 });
    const outra = new Config(d);
    expect(outra.obter().provedor).toBe('claude');
    expect(outra.obter().paralelismo).toBe(2);
  });

  it('lê a chave do ElevenLabs do .env da pasta e devolve null quando não há', () => {
    const d = dir();
    const cfg = new Config(d);
    expect(cfg.chaveElevenLabs()).toBeNull();
    writeFileSync(join(d, '.env'), '# comentário\nELEVENLABS_API_KEY=abc123\nOUTRA=x\n');
    expect(cfg.chaveElevenLabs()).toBe('abc123');
  });

  it('grava a chave no .env sem perder as outras linhas', () => {
    const d = dir();
    writeFileSync(join(d, '.env'), 'OUTRA=x\nELEVENLABS_API_KEY=velha\n');
    const cfg = new Config(d);
    cfg.definirChaveElevenLabs('  nova  ');
    const texto = readFileSync(join(d, '.env'), 'utf8');
    expect(texto).toContain('OUTRA=x');
    expect(texto).toContain('ELEVENLABS_API_KEY=nova');
    expect(texto).not.toContain('velha');
    expect(cfg.chaveElevenLabs()).toBe('nova');
  });

  it('uma chave vazia apaga a chave', () => {
    const d = dir();
    const cfg = new Config(d);
    cfg.definirChaveElevenLabs('abc');
    cfg.definirChaveElevenLabs('');
    expect(cfg.chaveElevenLabs()).toBeNull();
  });

  it('um .env extra (projeto em desenvolvimento) serve de reserva', () => {
    const d = dir();
    const reserva = dir();
    writeFileSync(join(reserva, '.env'), 'ELEVENLABS_API_KEY=da-reserva\n');
    const cfg = new Config(d, [join(reserva, '.env')]);
    expect(cfg.chaveElevenLabs()).toBe('da-reserva');
  });
});
