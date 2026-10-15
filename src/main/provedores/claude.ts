import { ErroPausa } from '../job';
import { executarProcesso } from './processo';
import type { OpcoesExecutavel, Pedido, Provedor, StatusProvedor } from './tipos';

/** Argumentos do `claude -p` para uma tarefa com resposta em JSON. Sem --bare: bare ignora o login da assinatura. */
export function montarArgsClaude(pedido: Pedido): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(pedido.schema),
    '--permission-mode',
    'dontAsk',
    '--allowedTools',
    'Read',
    '--add-dir',
    pedido.cwd,
    ...(pedido.dirsExtras ?? []),
    '--max-turns',
    '40',
  ];
}

export function interpretarStatusClaude(stdout: string): { logado: boolean; conta: string | null } {
  try {
    const dados = JSON.parse(stdout.trim()) as { loggedIn?: boolean; email?: string; subscriptionType?: string };
    if (!dados.loggedIn) return { logado: false, conta: null };
    const partes = [dados.email, dados.subscriptionType ? `(${dados.subscriptionType})` : null].filter(Boolean);
    return { logado: true, conta: partes.join(' ') || 'conta Claude' };
  } catch {
    return { logado: false, conta: null };
  }
}

interface SaidaClaude {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
}

function ultimoJson(texto: string): SaidaClaude | null {
  const inicio = texto.indexOf('{');
  if (inicio < 0) return null;
  try {
    return JSON.parse(texto.slice(inicio)) as SaidaClaude;
  } catch {
    return null;
  }
}

/** Transforma a falha do CLI em ErroPausa (limite/login) ou Error comum. */
export function classificarErroIA(mensagem: string, provedor: string): Error {
  if (/usage limit|rate limit|hit your limit|limit reached|overloaded|too many requests|429/i.test(mensagem)) {
    return new ErroPausa(`Limite de uso da assinatura do ${provedor} atingido. ${mensagem}`.trim());
  }
  if (/not logged in|please run \/login|login required|authentication|unauthorized|invalid api key|401|403/i.test(mensagem)) {
    return new ErroPausa(`Login do ${provedor} expirou ou não foi feito. Entre de novo na tela inicial. ${mensagem}`.trim());
  }
  return new Error(`${provedor}: ${mensagem}`);
}

export class ProvedorClaude implements Provedor {
  readonly id = 'claude' as const;
  readonly nome = 'Claude';

  constructor(private opcoes: OpcoesExecutavel) {}

  private env(): Record<string, string> {
    return { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false', ...this.opcoes.env };
  }

  async status(): Promise<StatusProvedor> {
    const { executavel, argsPrefixo = [] } = this.opcoes;
    try {
      const r = await executarProcesso(executavel, [...argsPrefixo, 'auth', 'status'], { env: this.env(), timeoutMs: 60_000 });
      const s = interpretarStatusClaude(r.stdout);
      return { instalado: true, caminho: executavel, ...s, detalhe: s.logado ? undefined : (r.stderr || r.stdout).trim().slice(0, 300) };
    } catch (erro) {
      return { instalado: false, logado: false, conta: null, caminho: null, detalhe: String(erro) };
    }
  }

  async rodar(pedido: Pedido): Promise<unknown> {
    const { executavel, argsPrefixo = [], timeoutMs } = this.opcoes;
    const r = await executarProcesso(executavel, [...argsPrefixo, ...montarArgsClaude(pedido)], {
      stdin: pedido.prompt,
      cwd: pedido.cwd,
      env: this.env(),
      timeoutMs,
    });
    if (r.expirou) throw new Error(`Claude demorou demais na tarefa "${pedido.nomeTarefa}" e foi interrompido.`);
    const saida = ultimoJson(r.stdout);
    if (!saida) {
      throw classificarErroIA((r.stderr || r.stdout).trim().slice(0, 500) || `saiu com código ${r.codigo}`, 'Claude');
    }
    if (saida.is_error || r.codigo !== 0) {
      throw classificarErroIA(String(saida.result ?? saida.subtype ?? r.stderr).trim().slice(0, 500), 'Claude');
    }
    if (saida.structured_output !== undefined) return saida.structured_output;
    try {
      return JSON.parse(String(saida.result ?? ''));
    } catch {
      throw new Error(`Claude não devolveu JSON na tarefa "${pedido.nomeTarefa}".`);
    }
  }
}
