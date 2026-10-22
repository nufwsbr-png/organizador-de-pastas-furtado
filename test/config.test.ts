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

  it('transcrição começa no ElevenLabs; a chave do OpenRouter fica no .env ao lado da do ElevenLabs', () => {
    const d = dir();
    const cfg = new Config(d);
    expect(cfg.obter().transcricao).toBe('elevenlabs');
    expect(cfg.obter().modeloOpenRouter).toBe('mistralai/voxtral-mini-transcribe');
    cfg.definirChaveElevenLabs('el');
    cfg.definirChaveOpenRouter(' sk-or-1 ');
    cfg.definir({ transcricao: 'openrouter' });
    const texto = readFileSync(join(d, '.env'), 'utf8');
    expect(texto).toContain('ELEVENLABS_API_KEY=el');
    expect(texto).toContain('OPENROUTER_API_KEY=sk-or-1');
    const outra = new Config(d);
    expect(outra.chaveOpenRouter()).toBe('sk-or-1');
    expect(outra.obter().transcricao).toBe('openrouter');
  });

  it('uma chave vazia apaga a chave', () => {
    const d = dir();
    const cfg = new Config(d);
    cfg.definirChaveElevenLabs('abc');
    cfg.definirChaveElevenLabs('');
    expect(cfg.chaveElevenLabs()).toBeNull();
  });

  it('guarda a conta de serviço do Google no .env, em base64', () => {
    const d = dir();
    const cfg = new Config(d);
    expect(cfg.contaServico()).toBeNull();
    const json = join(d, 'conta.json');
    writeFileSync(json, JSON.stringify({ type: 'service_account', client_email: 'robo@x.iam.gserviceaccount.com', private_key: 'k' }));
    expect(cfg.definirContaServico(json)).toBe('robo@x.iam.gserviceaccount.com');
    expect(readFileSync(join(d, '.env'), 'utf8')).toMatch(/^GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=[A-Za-z0-9+/=]+$/m);
    expect(new Config(d).contaServico()).toEqual({
      email: 'robo@x.iam.gserviceaccount.com',
      credenciais: { type: 'service_account', client_email: 'robo@x.iam.gserviceaccount.com', private_key: 'k' },
    });
    cfg.definirContaServico(null);
    expect(cfg.contaServico()).toBeNull();
  });

  it('recusa JSON que não é de conta de serviço', () => {
    const d = dir();
    const json = join(d, 'outro.json');
    writeFileSync(json, JSON.stringify({ type: 'authorized_user' }));
    expect(() => new Config(d).definirContaServico(json)).toThrow('conta de serviço');
  });

  it('um .env extra (projeto em desenvolvimento) serve de reserva', () => {
    const d = dir();
    const reserva = dir();
    writeFileSync(join(reserva, '.env'), 'ELEVENLABS_API_KEY=da-reserva\n');
    const cfg = new Config(d, [join(reserva, '.env')]);
    expect(cfg.chaveElevenLabs()).toBe('da-reserva');
  });
});
