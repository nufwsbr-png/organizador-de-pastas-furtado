import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Provedor = 'claude' | 'codex';
export type Tema = 'sistema' | 'claro' | 'escuro';
export type ServicoTranscricao = 'elevenlabs' | 'openrouter';
export type ModeloOpenRouter = 'mistralai/voxtral-mini-transcribe' | 'openai/whisper-large-v3-turbo' | 'openai/gpt-4o-mini-transcribe';

export interface Ajustes {
  /** Provedor de IA escolhido na tela de login. */
  provedor: Provedor | null;
  /** Quantas pastas são organizadas ao mesmo tempo. */
  paralelismo: number;
  /** Endereço do WAHA (ex.: https://pastas.nufws.com.br) e sessão do WhatsApp do escritório. */
  wahaUrl: string;
  wahaSessao: string;
  /** Link ou ID da planilha Contratos/Entrevistas/Pastas e a aba dos clientes. */
  planilhaId: string;
  planilhaAba: string;
  /** Modo claro, noturno ou igual ao Windows. */
  tema: Tema;
  /** Quem transcreve o áudio da ligação: ElevenLabs (separa quem fala) ou Whisper pelo OpenRouter. */
  transcricao: ServicoTranscricao;
  /** Modelo do OpenRouter (comparados numa ligação real em 22/10/2026: o Voxtral foi o mais fiel). */
  modeloOpenRouter: ModeloOpenRouter;
}

const PADRAO: Ajustes = {
  provedor: null,
  paralelismo: 3,
  wahaUrl: '',
  wahaSessao: 'furtado',
  planilhaId: '',
  planilhaAba: 'Lançamentos',
  tema: 'sistema',
  transcricao: 'elevenlabs',
  modeloOpenRouter: 'mistralai/voxtral-mini-transcribe',
};
const CHAVE_ELEVENLABS = 'ELEVENLABS_API_KEY';
const CHAVE_OPENROUTER = 'OPENROUTER_API_KEY';
const TOKEN_ZAPSIGN = 'ZAPSIGN_API_TOKEN';
const CHAVE_WAHA = 'WAHA_API_KEY';
const CONTA_SERVICO = 'GOOGLE_SERVICE_ACCOUNT_JSON_BASE64';

export interface ContaServico {
  email: string;
  credenciais: object;
}

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
    return this.segredo(CHAVE_ELEVENLABS);
  }

  definirChaveElevenLabs(chave: string): void {
    this.definirSegredo(CHAVE_ELEVENLABS, chave);
  }

  chaveOpenRouter(): string | null {
    return this.segredo(CHAVE_OPENROUTER);
  }

  definirChaveOpenRouter(chave: string): void {
    this.definirSegredo(CHAVE_OPENROUTER, chave);
  }

  tokenZapsign(): string | null {
    return this.segredo(TOKEN_ZAPSIGN);
  }

  chaveWaha(): string | null {
    return this.segredo(CHAVE_WAHA);
  }

  definirChaveWaha(chave: string): void {
    this.definirSegredo(CHAVE_WAHA, chave);
  }

  /** Conta de serviço do Google (o JSON baixado no Google Cloud), guardada em base64 no .env. */
  contaServico(): ContaServico | null {
    const base64 = this.segredo(CONTA_SERVICO);
    if (!base64) return null;
    try {
      const credenciais = JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as { client_email?: string };
      return credenciais.client_email ? { email: credenciais.client_email, credenciais } : null;
    } catch {
      return null;
    }
  }

  /** Grava no .env, em base64, o JSON da conta de serviço (ou apaga, com null). Devolve o e-mail da conta. */
  definirContaServico(origem: string | null): string | null {
    if (origem === null) {
      this.definirSegredo(CONTA_SERVICO, '');
      return null;
    }
    let dados: { type?: string; client_email?: string; private_key?: string };
    try {
      dados = JSON.parse(readFileSync(origem, 'utf8'));
    } catch {
      throw new Error('Esse arquivo não é um JSON válido.');
    }
    if (dados.type !== 'service_account' || !dados.client_email || !dados.private_key) {
      throw new Error('Esse JSON não é de uma conta de serviço do Google (falta type "service_account", client_email ou private_key).');
    }
    this.definirSegredo(CONTA_SERVICO, Buffer.from(JSON.stringify(dados)).toString('base64'));
    return dados.client_email;
  }

  definirTokenZapsign(token: string): void {
    this.definirSegredo(TOKEN_ZAPSIGN, token);
  }

  private segredo(nome: string): string | null {
    for (const arquivo of [this.arquivoEnv, ...this.envsReserva]) {
      const valor = lerEnv(arquivo)[nome]?.trim();
      if (valor) return valor;
    }
    return null;
  }

  /** Grava (ou apaga, se vazio) o segredo no .env do app, preservando as outras linhas. */
  private definirSegredo(nome: string, valor: string): void {
    const limpo = valor.trim();
    const linhas = existsSync(this.arquivoEnv)
      ? readFileSync(this.arquivoEnv, 'utf8').split(/\r?\n/)
      : [];
    const semChave = linhas.filter((l) => !l.trim().startsWith(`${nome}=`));
    while (semChave.length > 0 && semChave[semChave.length - 1] === '') semChave.pop();
    if (limpo) semChave.push(`${nome}=${limpo}`);
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
