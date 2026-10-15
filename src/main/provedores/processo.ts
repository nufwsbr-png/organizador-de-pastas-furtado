import { spawn, type ChildProcess } from 'node:child_process';
import { extname } from 'node:path';

export interface ResultadoProcesso {
  codigo: number | null;
  stdout: string;
  stderr: string;
  expirou: boolean;
}

export interface OpcoesProcesso {
  stdin?: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

const ativos = new Set<ChildProcess>();
let encerrando = false;

/** Verdadeiro depois que o app começou a fechar (os jobs interrompidos voltam para a fila). */
export function estaEncerrando(): boolean {
  return encerrando;
}

/** Só para testes. */
export function reiniciarEncerramento(): void {
  encerrando = false;
}

/** Mata o processo e tudo que ele abriu (no Windows, um .cmd abre node/claude por baixo). */
export function matarArvore(p: ChildProcess): void {
  try {
    if (process.platform === 'win32' && p.pid) {
      spawn('taskkill', ['/pid', String(p.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).on('error', () => p.kill());
    } else {
      p.kill();
    }
  } catch {
    /* já morreu */
  }
}

/** Mata os processos filhos ainda abertos (chamado ao fechar o app). */
export function matarProcessos(): void {
  encerrando = true;
  for (const p of ativos) matarArvore(p);
  ativos.clear();
}

/** Coloca aspas num argumento para o cmd.exe (só usado com .cmd/.bat). */
export function citarParaCmd(arg: string): string {
  if (arg !== '' && !/[\s"&|<>^%()]/.test(arg)) return arg;
  return '"' + arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}

/** Roda um executável, manda o stdin, junta a saída. Scripts .cmd/.bat passam pelo cmd.exe. */
export function executarProcesso(executavel: string, args: string[], opcoes: OpcoesProcesso = {}): Promise<ResultadoProcesso> {
  const { stdin, cwd, env, timeoutMs = 20 * 60_000 } = opcoes;
  const ext = extname(executavel).toLowerCase();
  const viaCmd = process.platform === 'win32' && (ext === '.cmd' || ext === '.bat');

  return new Promise((resolve, reject) => {
    const filho = viaCmd
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"${[executavel, ...args].map(citarParaCmd).join(' ')}"`], {
          cwd,
          env: { ...process.env, ...env },
          windowsVerbatimArguments: true,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      : spawn(executavel, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    ativos.add(filho);
    let stdout = '';
    let stderr = '';
    let expirou = false;
    filho.stdout.setEncoding('utf8');
    filho.stderr.setEncoding('utf8');
    filho.stdout.on('data', (c: string) => (stdout += c));
    filho.stderr.on('data', (c: string) => (stderr += c));

    const timer = setTimeout(() => {
      expirou = true;
      matarArvore(filho);
    }, timeoutMs);

    filho.on('error', (erro) => {
      clearTimeout(timer);
      ativos.delete(filho);
      reject(erro);
    });
    filho.on('close', (codigo) => {
      clearTimeout(timer);
      ativos.delete(filho);
      resolve({ codigo, stdout, stderr, expirou });
    });

    if (stdin !== undefined) filho.stdin.end(stdin, 'utf8');
    else filho.stdin.end();
  });
}
