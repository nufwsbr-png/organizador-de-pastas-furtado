import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { IdProvedor } from './tipos';

const APPDATA = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
const NPM = join(APPDATA, 'npm');

/** Onde cada CLI costuma ficar no Windows, do melhor para o pior candidato. */
export function candidatosPadrao(nome: IdProvedor, extras: string[] = []): string[] {
  if (nome === 'claude') {
    return [
      ...extras,
      join(homedir(), '.local', 'bin', 'claude.exe'),
      join(NPM, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
      join(NPM, 'node_modules', '@anthropic-ai', 'claude-code', 'node_modules', '@anthropic-ai', 'claude-code-win32-x64', 'claude.exe'),
      join(NPM, 'claude.exe'),
      join(NPM, 'claude.cmd'),
    ];
  }
  return [
    ...extras,
    join(NPM, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'),
    join(NPM, 'codex.cmd'),
  ];
}

export interface OpcoesLocalizar {
  candidatos?: string[];
  /** PATH a varrer (padrão: o do processo). */
  path?: string;
}

/** Devolve o caminho do executável do CLI, ou null se não está instalado. */
export function localizarExecutavel(nome: IdProvedor, opcoes: OpcoesLocalizar = {}): string | null {
  const candidatos = opcoes.candidatos ?? candidatosPadrao(nome);
  for (const c of candidatos) if (existsSync(c)) return c;

  const path = opcoes.path ?? process.env.PATH ?? '';
  const sufixos = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of path.split(delimiter).filter(Boolean)) {
    for (const s of sufixos) {
      const caminho = join(dir, nome + s);
      if (existsSync(caminho)) return caminho;
    }
  }
  return null;
}
