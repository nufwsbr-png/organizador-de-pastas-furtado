import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * ZapSign pela API (só leitura): acha os envelopes do cliente e baixa os PDFs assinados.
 * A API não busca por nome (só por e-mail do signatário), então o app guarda um índice local
 * da listagem (zapsign-indice.json): na primeira vez lista a janela inteira, depois só o que entrou.
 * Docs: docs.zapsign.com.br → Documentos → Listar / Detalhar.
 */

export const URL_ZAPSIGN = 'https://api.zapsign.com.br/api/v1';
const DIA = 86_400_000;

export interface SignatarioIndice {
  nome: string;
  status: string;
}

/** Documento principal de um envelope (os anexos vêm na listagem sem signatários e são ignorados). */
export interface EnvelopeIndice {
  token: string;
  nome: string;
  status: string;
  criadoEm: string;
  signatarios: SignatarioIndice[];
}

export interface DocumentoEnvelope {
  nome: string;
  /** Link do PDF assinado (vale por pouco tempo: baixe logo). */
  arquivoAssinado: string | null;
}

export interface EnvelopeDetalhe {
  token: string;
  nome: string;
  status: string;
  criadoEm: string;
  signatarios: { nome: string; status: string; assinadoEm: string | null }[];
  /** Documento principal e anexos, nessa ordem. */
  documentos: DocumentoEnvelope[];
}

/** O que a etapa do ZapSign usa (o cliente real ou um falso nos testes). */
export interface FonteZapsign {
  buscarPorNome(nome: string): Promise<{ envelopes: EnvelopeIndice[]; desde: string }>;
  buscarPorEmail(email: string): Promise<EnvelopeIndice[]>;
  detalhar(token: string): Promise<EnvelopeDetalhe>;
  baixar(url: string): Promise<Buffer>;
}

interface ArquivoIndice {
  versao: 1;
  /** Data (AAAA-MM-DD) desde a qual o índice tem todos os envelopes. */
  desde: string;
  sincronizadoEm: string | null;
  envelopes: EnvelopeIndice[];
}

/** A listagem devolve os campos do signatário em português; o detalhe, em inglês. */
interface SignatarioApi {
  name?: string;
  nome?: string;
  status?: string;
  signed_at?: string | null;
  data_hora_assinatura?: string | null;
}

interface DocumentoApi {
  token: string;
  name: string;
  status: string;
  created_at: string;
  deleted?: boolean;
  signed_file?: string | null;
  signers?: SignatarioApi[];
  extra_docs?: { name: string; signed_file?: string | null }[];
}

interface PaginaApi {
  count: number;
  next: string | null;
  results: DocumentoApi[];
}

export class ErroZapsign extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroZapsign';
  }
}

export interface OpcoesZapsign {
  token: () => string | null;
  /** Onde o índice da listagem fica gravado (userData/zapsign-indice.json). */
  arquivoIndice: string;
  base?: string;
  /** Quantos dias para trás o índice cobre. */
  janelaDias?: number;
  /** Páginas da listagem baixadas ao mesmo tempo. */
  concorrencia?: number;
  /** Índice mais novo que isso não é sincronizado de novo (várias pastas buscando juntas). */
  frescorMs?: number;
  esperar?: (ms: number) => Promise<void>;
  log?: (texto: string) => void;
}

export class ClienteZapsign implements FonteZapsign {
  private base: string;
  private janelaDias: number;
  private concorrencia: number;
  private frescorMs: number;
  private esperar: (ms: number) => Promise<void>;
  private indice: ArquivoIndice | null = null;
  private sincronizando: Promise<void> | null = null;

  constructor(private opcoes: OpcoesZapsign) {
    this.base = (opcoes.base ?? URL_ZAPSIGN).replace(/\/$/, '');
    this.janelaDias = opcoes.janelaDias ?? 365;
    this.concorrencia = opcoes.concorrencia ?? 4;
    this.frescorMs = opcoes.frescorMs ?? 60_000;
    this.esperar = opcoes.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Confere o token e diz quantos documentos a conta tem. */
  async testar(): Promise<string> {
    const r = await this.chamar<PaginaApi>('/docs/', { page: 1, deleted: false });
    return `Token válido: ${r.count} documento(s) ativos na conta.`;
  }

  /** Atualiza o índice local (uma sincronização por vez; quem chega junto espera a mesma). */
  sincronizar(): Promise<void> {
    if (!this.sincronizando) this.sincronizando = this.sincronizarAgora().finally(() => (this.sincronizando = null));
    return this.sincronizando;
  }

  async buscarPorNome(nome: string): Promise<{ envelopes: EnvelopeIndice[]; desde: string }> {
    await this.sincronizar();
    const indice = this.carregar();
    const envelopes = indice.envelopes.filter((e) => e.signatarios.some((s) => grauNome(nome, s.nome) !== null));
    return { envelopes, desde: indice.desde };
  }

  async buscarPorEmail(email: string): Promise<EnvelopeIndice[]> {
    const r = await this.chamar<PaginaApi>('/docs/', { page: 1, signer_email: email.trim(), include_signers: true, sort_order: 'desc', deleted: false });
    return r.results.filter(ehEnvelope).map(paraIndice);
  }

  async detalhar(token: string): Promise<EnvelopeDetalhe> {
    const d = await this.chamar<DocumentoApi>(`/docs/${encodeURIComponent(token)}/`);
    return {
      token: d.token,
      nome: d.name,
      status: d.status,
      criadoEm: d.created_at,
      signatarios: (d.signers ?? []).map((s) => ({ nome: s.name ?? s.nome ?? '', status: s.status ?? '', assinadoEm: s.signed_at ?? s.data_hora_assinatura ?? null })),
      documentos: [{ nome: d.name, arquivoAssinado: d.signed_file ?? null }, ...(d.extra_docs ?? []).map((x) => ({ nome: x.name, arquivoAssinado: x.signed_file ?? null }))],
    };
  }

  async baixar(url: string): Promise<Buffer> {
    const r = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    if (!r.ok) throw new ErroZapsign(`O download do PDF assinado falhou (HTTP ${r.status}).`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ErroZapsign('O ZapSign devolveu um arquivo que não é PDF.');
    return buf;
  }

  private async sincronizarAgora(): Promise<void> {
    const indice = this.carregar();
    if (indice.sincronizadoEm && Date.now() - Date.parse(indice.sincronizadoEm) < this.frescorMs) return;
    const inicioJanela = dia(Date.now() - this.janelaDias * DIA);
    // primeira vez: a janela inteira; depois, só o que entrou desde a última vez (2 dias de folga pegam mudança de status)
    const incremental = indice.sincronizadoEm !== null && indice.desde <= inicioJanela;
    const desde = incremental ? dia(Date.parse(indice.sincronizadoEm!) - 2 * DIA) : inicioJanela;
    const inicio = Date.now();
    if (!incremental) this.opcoes.log?.(`zapsign: montando o índice desde ${desde}`);
    const novos = await this.listarDesde(desde);

    const porToken = new Map(incremental ? indice.envelopes.map((e) => [e.token, e]) : []);
    for (const e of novos) porToken.set(e.token, e);
    this.indice = {
      versao: 1,
      desde: inicioJanela,
      sincronizadoEm: new Date(inicio).toISOString(),
      envelopes: [...porToken.values()].filter((e) => e.criadoEm.slice(0, 10) >= inicioJanela).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)),
    };
    this.salvar();
    this.opcoes.log?.(`zapsign: índice com ${this.indice.envelopes.length} envelope(s), ${novos.length} lido(s) em ${Date.now() - inicio} ms`);
  }

  /** Lista tudo criado desde a data: lê a 1ª página, depois as outras em paralelo. */
  private async listarDesde(desde: string): Promise<EnvelopeIndice[]> {
    // created_from sozinho é ignorado pela API: só filtra com created_to junto (que inclui o próprio dia)
    const params = { include_signers: true, sort_order: 'desc', deleted: false, created_from: desde, created_to: dia(Date.now() + DIA) };
    const primeira = await this.chamar<PaginaApi>('/docs/', { ...params, page: 1 });
    const resultados = [...primeira.results];
    const porPagina = Math.max(1, primeira.results.length);
    const paginas = primeira.next ? Math.min(Math.ceil(primeira.count / porPagina), 4000) : 1;
    let proxima = 2;
    const trabalhar = async () => {
      while (proxima <= paginas) {
        const page = proxima++;
        resultados.push(...(await this.chamar<PaginaApi>('/docs/', { ...params, page })).results);
      }
    };
    await Promise.all(Array.from({ length: this.concorrencia }, trabalhar));
    return resultados.filter(ehEnvelope).map(paraIndice);
  }

  private async chamar<T>(caminho: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
    const token = this.opcoes.token();
    if (!token) throw new ErroZapsign('Falta o token da API do ZapSign (Ajustes).');
    const url = new URL(this.base + caminho);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    for (let tentativa = 1; ; tentativa++) {
      let r: Response;
      try {
        r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
      } catch (erro) {
        if (tentativa < 4) {
          await this.esperar(1000 * 2 ** (tentativa - 1));
          continue;
        }
        throw new ErroZapsign(`Não consegui falar com o ZapSign: ${erro instanceof Error ? erro.message : String(erro)}`);
      }
      if (r.ok) return (await r.json()) as T;
      if (r.status === 401 || r.status === 403) throw new ErroZapsign(`O ZapSign recusou o token da API (HTTP ${r.status}). Confira o token em Ajustes.`);
      if (r.status === 402) throw new ErroZapsign('A conta do ZapSign não tem o Plano de API ativo (HTTP 402).');
      if (r.status === 404) throw new ErroZapsign('Esse documento não existe no ZapSign (HTTP 404).');
      if ((r.status === 429 || r.status >= 500) && tentativa < 4) {
        const pedido = Number(r.headers.get('retry-after'));
        await this.esperar(pedido > 0 ? pedido * 1000 : 1000 * 2 ** (tentativa - 1));
        continue;
      }
      throw new ErroZapsign(`O ZapSign respondeu HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
  }

  private carregar(): ArquivoIndice {
    if (this.indice) return this.indice;
    try {
      const dados = JSON.parse(readFileSync(this.opcoes.arquivoIndice, 'utf8')) as ArquivoIndice;
      if (dados.versao === 1 && Array.isArray(dados.envelopes)) this.indice = dados;
    } catch {
      /* sem índice ainda */
    }
    this.indice ??= { versao: 1, desde: dia(Date.now()), sincronizadoEm: null, envelopes: [] };
    return this.indice;
  }

  private salvar(): void {
    const arquivo = this.opcoes.arquivoIndice;
    mkdirSync(dirname(arquivo), { recursive: true });
    writeFileSync(`${arquivo}.tmp`, JSON.stringify(this.indice));
    renameSync(`${arquivo}.tmp`, arquivo);
  }
}

function ehEnvelope(d: DocumentoApi): boolean {
  return !d.deleted && (d.signers ?? []).length > 0;
}

function paraIndice(d: DocumentoApi): EnvelopeIndice {
  return {
    token: d.token,
    nome: d.name,
    status: d.status,
    criadoEm: d.created_at,
    signatarios: (d.signers ?? []).map((s) => ({ nome: s.nome ?? s.name ?? '', status: s.status ?? '' })),
  };
}

function dia(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Palavras de um nome sem acento, minúsculas; só as com mais de 2 letras contam. */
export function palavrasDoNome(nome: string): string[] {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length > 2);
}

/**
 * Quanto o nome procurado (o da pasta) bate com o do signatário:
 * 'igual' = mesmas palavras; 'parecido' = um contém todas as palavras do outro (no mínimo duas);
 * null = não é a mesma pessoa.
 */
export function grauNome(procurado: string, signatario: string): 'igual' | 'parecido' | null {
  const a = palavrasDoNome(procurado);
  const b = palavrasDoNome(signatario);
  if (a.length === 0 || b.length === 0) return null;
  const sa = new Set(a);
  const sb = new Set(b);
  if (a.join(' ') === b.join(' ')) return 'igual';
  const aEmB = a.every((p) => sb.has(p));
  const bEmA = b.every((p) => sa.has(p));
  if ((aEmB && a.length >= 2) || (bEmA && b.length >= 2)) return 'parecido';
  return null;
}
