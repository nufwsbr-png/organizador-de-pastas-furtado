export type IdProvedor = 'claude' | 'codex';

export interface Pedido {
  /** Texto completo da tarefa (vai por stdin). */
  prompt: string;
  /** JSON Schema da resposta esperada. */
  schema: object;
  /** PNGs que a IA precisa olhar (caminhos absolutos). */
  imagens: string[];
  /** Pasta de trabalho / pasta com permissão de leitura. */
  cwd: string;
  /** Outras pastas que a IA pode ler (ex.: PNGs gerados na pasta do job). */
  dirsExtras?: string[];
  /** Nome curto para logs. */
  nomeTarefa: string;
}

export interface StatusProvedor {
  instalado: boolean;
  logado: boolean;
  /** Conta/assinatura, quando logado (ex.: "a@b.com (max)" ou "ChatGPT"). */
  conta: string | null;
  /** Caminho do executável encontrado. */
  caminho: string | null;
  detalhe?: string;
}

export interface Provedor {
  id: IdProvedor;
  nome: string;
  status(): Promise<StatusProvedor>;
  /** Executa a tarefa e devolve o JSON que obedece ao schema. */
  rodar(pedido: Pedido): Promise<unknown>;
}

export interface OpcoesExecutavel {
  executavel: string;
  /** Argumentos que vêm antes dos da tarefa (nos testes, o script falso). */
  argsPrefixo?: string[];
  timeoutMs?: number;
  env?: Record<string, string>;
}
