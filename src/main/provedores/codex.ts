import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { classificarErroIA } from './claude';
import { executarProcesso } from './processo';
import type { OpcoesExecutavel, Pedido, Provedor, StatusProvedor } from './tipos';

export function montarArgsCodex(pedido: Pedido, arquivoSchema: string, arquivoSaida: string): string[] {
  const args = [
    'exec',
    '-',
    '--json',
    '--output-schema',
    arquivoSchema,
    '-o',
    arquivoSaida,
    '-C',
    pedido.cwd,
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--color',
    'never',
  ];
  for (const img of pedido.imagens) args.push('-i', img);
  return args;
}

export function interpretarStatusCodex(stdout: string): { logado: boolean; conta: string | null } {
  const m = /logged in using (.+)/i.exec(stdout);
  if (m) return { logado: true, conta: m[1].trim() };
  return { logado: false, conta: null };
}

interface EventoCodex {
  type?: string;
  message?: string;
  error?: { message?: string };
}

function errosDoJsonl(texto: string): string[] {
  const erros: string[] = [];
  for (const linha of texto.split(/\r?\n/)) {
    if (!linha.trim().startsWith('{')) continue;
    try {
      const ev = JSON.parse(linha) as EventoCodex;
      if (ev.type === 'error' || ev.type === 'turn.failed') erros.push(ev.message ?? ev.error?.message ?? linha);
    } catch {
      /* linha que não é JSON */
    }
  }
  return erros;
}

export class ProvedorCodex implements Provedor {
  readonly id = 'codex' as const;
  readonly nome = 'ChatGPT (Codex)';

  constructor(private opcoes: OpcoesExecutavel & { pastaTemp?: string }) {}

  async status(): Promise<StatusProvedor> {
    const { executavel, argsPrefixo = [] } = this.opcoes;
    try {
      const r = await executarProcesso(executavel, [...argsPrefixo, 'login', 'status'], { env: this.opcoes.env, timeoutMs: 60_000 });
      const s = interpretarStatusCodex(r.stdout + '\n' + r.stderr);
      return { instalado: true, caminho: executavel, ...s, detalhe: s.logado ? undefined : (r.stderr || r.stdout).trim().slice(0, 300) };
    } catch (erro) {
      return { instalado: false, logado: false, conta: null, caminho: null, detalhe: String(erro) };
    }
  }

  async rodar(pedido: Pedido): Promise<unknown> {
    const { executavel, argsPrefixo = [], timeoutMs } = this.opcoes;
    const pastaTemp = join(this.opcoes.pastaTemp ?? tmpdir(), 'codex-' + randomUUID());
    mkdirSync(pastaTemp, { recursive: true });
    const arquivoSchema = join(pastaTemp, 'schema.json');
    const arquivoSaida = join(pastaTemp, 'saida.json');
    writeFileSync(arquivoSchema, JSON.stringify(pedido.schema));
    try {
      const r = await executarProcesso(executavel, [...argsPrefixo, ...montarArgsCodex(pedido, arquivoSchema, arquivoSaida)], {
        stdin: pedido.prompt,
        cwd: pedido.cwd,
        env: this.opcoes.env,
        timeoutMs,
      });
      if (r.expirou) throw new Error(`Codex demorou demais na tarefa "${pedido.nomeTarefa}" e foi interrompido.`);
      const erros = errosDoJsonl(r.stdout);
      if (!existsSync(arquivoSaida)) {
        const motivo = erros.join(' | ') || (r.stderr || r.stdout).trim().slice(0, 500) || `saiu com código ${r.codigo}`;
        throw classificarErroIA(motivo, 'ChatGPT');
      }
      const texto = readFileSync(arquivoSaida, 'utf8');
      try {
        return JSON.parse(texto);
      } catch {
        throw new Error(`Codex não devolveu JSON na tarefa "${pedido.nomeTarefa}": ${texto.slice(0, 200)}`);
      }
    } finally {
      rmSync(pastaTemp, { recursive: true, force: true });
    }
  }
}
