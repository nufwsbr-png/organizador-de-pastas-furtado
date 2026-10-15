import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Provedor = 'claude' | 'codex';

export interface Ajustes {
  /** Provedor de IA escolhido na tela de login. */
  provedor: Provedor | null;
  /** Quantas pastas são organizadas ao mesmo tempo. */
  paralelismo: number;
}

const PADRAO: Ajustes = { provedor: null, paralelismo: 3 };
const CHAVE_ELEVENLABS = 'ELEVENLABS_API_KEY';

/** Ajustes do app (settings.json) e segredos (.env) guardados na pasta de dados do usuário. */
export class Config {
  private ajustes: Ajustes;
  private arquivoAjustes: string;
  private arquivoEnv: string;

  /**
   * @param pasta pasta de dados (userData); recebe settings.json e .env
   * @param envsReserva outros .env lidos só quando o principal não tem a chave (ex.: raiz do projeto em dev)
   */
  constructor(
    pasta: string,
    private envsReserva: string[] = [],
  ) {
    mkdirSync(pasta, { recursive: true });
    this.arquivoAjustes = join(pasta, 'settings.json');
    this.arquivoEnv = join(pasta, '.env');
    this.ajustes = { ...PADRAO, ...this.lerAjustes() };
  }

  private lerAjustes(): Partial<Ajustes> {
    try {
      return JSON.parse(readFileSync(this.arquivoAjustes, 'utf8')) as Partial<Ajustes>;
    } catch {
      return {};
    }
  }

  obter(): Ajustes {
    return { ...this.ajustes };
  }

  definir(mudancas: Partial<Ajustes>): Ajustes {
    this.ajustes = { ...this.ajustes, ...mudancas };
    writeFileSync(this.arquivoAjustes, JSON.stringify(this.ajustes, null, 2));
    return this.obter();
  }

  chaveElevenLabs(): string | null {
    for (const arquivo of [this.arquivoEnv, ...this.envsReserva]) {
      const valor = lerEnv(arquivo)[CHAVE_ELEVENLABS]?.trim();
      if (valor) return valor;
    }
    return null;
  }

  /** Grava (ou apaga, se vazia) a chave no .env do app, preservando as outras linhas. */
  definirChaveElevenLabs(chave: string): void {
    const valor = chave.trim();
    const linhas = existsSync(this.arquivoEnv)
      ? readFileSync(this.arquivoEnv, 'utf8').split(/\r?\n/)
      : [];
    const semChave = linhas.filter((l) => !l.trim().startsWith(`${CHAVE_ELEVENLABS}=`));
    while (semChave.length > 0 && semChave[semChave.length - 1] === '') semChave.pop();
    if (valor) semChave.push(`${CHAVE_ELEVENLABS}=${valor}`);
    writeFileSync(this.arquivoEnv, semChave.join('\n') + '\n');
  }

  caminhoEnv(): string {
    return this.arquivoEnv;
  }
}

/** Lê um .env simples (CHAVE=valor, # comentários). */
export function lerEnv(arquivo: string): Record<string, string> {
  if (!existsSync(arquivo)) return {};
  const resultado: Record<string, string> = {};
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(linha);
    if (!m) continue;
    let valor = m[2].trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    resultado[m[1]] = valor;
  }
  return resultado;
}
