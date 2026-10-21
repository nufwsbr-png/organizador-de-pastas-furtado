import { formatarTelefone, telefoneNacional } from './nomes';

/**
 * WhatsApp do escritório pelo WAHA (só leitura: o app nunca envia mensagem).
 * O GOWS guarda o histórico completo sincronizado quando o aparelho foi conectado.
 * Docs: waha.devlike.pro → Chats (mensagens), Contacts (check-exists, lids).
 * No WAHA gratuito, o arquivo de mídia baixado some em 180 s: cada página da conversa é baixada e já gravada.
 */

export interface ConversaWhatsapp {
  chatId: string;
  /** O mesmo contato pode ter mensagens guardadas pelo número (@c.us) e pelo LID (@lid). */
  ids: string[];
  telefone: string;
}

export interface ArquivoWhatsapp {
  id: string;
  /** Segundos Unix, como o WhatsApp manda. */
  quando: number;
  mimetype: string;
  nomeArquivo?: string;
  conteudo: Buffer;
}

export interface FalhaWhatsapp {
  id: string;
  quando: number;
  motivo: string;
}

export interface ResumoConversa {
  mensagens: number;
  midias: number;
  falhas: FalhaWhatsapp[];
}

/** O que a etapa do WhatsApp usa (o WAHA real ou um falso nos testes). */
export interface FonteWhatsapp {
  acharConversa(telefone: string): Promise<ConversaWhatsapp | null>;
  /** Percorre a conversa inteira e entrega cada imagem ou documento que o cliente mandou. */
  midiasDoCliente(conversa: ConversaWhatsapp, aoArquivo: (a: ArquivoWhatsapp) => Promise<void>): Promise<ResumoConversa>;
}

interface MensagemApi {
  id: string;
  timestamp: number;
  fromMe?: boolean;
  hasMedia?: boolean;
  media?: { url?: string | null; mimetype?: string | null; filename?: string | null; error?: unknown } | null;
}

export class ErroWhatsapp extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroWhatsapp';
  }
}

/** Imagem ou documento que pode ser RG, CNH, CTPS, comprovante etc. Figurinha (webp), áudio e vídeo ficam de fora. */
export function ehDocumentoOuImagem(mimetype: string | null | undefined): boolean {
  const m = (mimetype ?? '').toLowerCase().split(';')[0].trim();
  if (m === 'image/webp') return false;
  if (m.startsWith('image/')) return true;
  return (
    m === 'application/pdf' ||
    m === 'application/msword' ||
    m === 'text/plain' ||
    m.startsWith('application/vnd.openxmlformats-officedocument') ||
    m.startsWith('application/vnd.oasis.opendocument') ||
    m.startsWith('application/vnd.ms-')
  );
}

export interface OpcoesWaha {
  url: () => string | null;
  apiKey: () => string | null;
  sessao: () => string;
  porPagina?: number;
  esperar?: (ms: number) => Promise<void>;
}

export class ClienteWaha implements FonteWhatsapp {
  private porPagina: number;
  private esperar: (ms: number) => Promise<void>;

  constructor(private opcoes: OpcoesWaha) {
    this.porPagina = opcoes.porPagina ?? 50;
    this.esperar = opcoes.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Confere endereço, chave e se a sessão do escritório está conectada. */
  async testar(): Promise<string> {
    const s = await this.chamar<{ status: string; me?: { id?: string; pushName?: string } | null }>(`/api/sessions/${encodeURIComponent(this.opcoes.sessao())}`);
    if (s.status !== 'WORKING') {
      throw new ErroWhatsapp(`A sessão "${this.opcoes.sessao()}" do WAHA está ${s.status}${s.status === 'SCAN_QR_CODE' ? ' (falta escanear o QR code no celular do escritório)' : ''}.`);
    }
    const quem = [s.me?.pushName, s.me?.id ? formatarTelefone(s.me.id.split('@')[0]) : ''].filter(Boolean).join(' · ');
    return `WhatsApp conectado${quem ? `: ${quem}` : ''}.`;
  }

  async acharConversa(telefone: string): Promise<ConversaWhatsapp | null> {
    const nacional = telefoneNacional(telefone);
    if (!nacional) throw new ErroWhatsapp(`Telefone inválido: "${telefone}".`);
    const sessao = this.opcoes.sessao();
    // o check-exists acerta o nono dígito e diz se o contato está como número ou como LID
    const r = await this.chamar<{ numberExists: boolean; chatId?: string; pn?: string | null }>('/api/contacts/check-exists', { phone: `55${nacional}`, session: sessao });
    if (!r.numberExists || !r.chatId) return null;
    const ids = new Set([r.chatId]);
    if (r.pn) ids.add(r.pn);
    const base = `/api/${encodeURIComponent(sessao)}/lids`;
    try {
      if (r.chatId.endsWith('@lid') && !r.pn) {
        const m = await this.chamar<{ pn?: string | null }>(`${base}/${encodeURIComponent(r.chatId)}`);
        if (m.pn) ids.add(m.pn);
      } else if (!r.chatId.endsWith('@lid')) {
        const m = await this.chamar<{ lid?: string | null }>(`${base}/pn/${encodeURIComponent(r.chatId.split('@')[0])}`);
        if (m.lid) ids.add(m.lid);
      }
    } catch {
      /* sem mapeamento de LID: segue só com o que o check-exists deu */
    }
    return { chatId: r.chatId, ids: [...ids], telefone: nacional };
  }

  async midiasDoCliente(conversa: ConversaWhatsapp, aoArquivo: (a: ArquivoWhatsapp) => Promise<void>): Promise<ResumoConversa> {
    const sessao = encodeURIComponent(this.opcoes.sessao());
    const vistas = new Set<string>();
    const resumo: ResumoConversa = { mensagens: 0, midias: 0, falhas: [] };
    for (const chatId of conversa.ids) {
      const caminho = `/api/${sessao}/chats/${encodeURIComponent(chatId)}/messages`;
      for (let pagina = 0; pagina < 400; pagina++) {
        const mensagens = await this.chamar<MensagemApi[]>(caminho, {
          limit: this.porPagina,
          offset: pagina * this.porPagina,
          'filter.fromMe': false,
          downloadMedia: true,
          downloadMediaMimetypes: 'image,application,text',
        });
        for (const m of mensagens) {
          if (vistas.has(m.id) || m.fromMe) continue;
          vistas.add(m.id);
          resumo.mensagens++;
          if (!m.hasMedia) continue;
          await this.entregar(caminho, m, aoArquivo, resumo);
        }
        if (mensagens.length < this.porPagina) break;
      }
    }
    return resumo;
  }

  /** Baixa a mídia de uma mensagem (de novo, pela mensagem, se o arquivo já tiver expirado no WAHA). */
  private async entregar(caminho: string, m: MensagemApi, aoArquivo: (a: ArquivoWhatsapp) => Promise<void>, resumo: ResumoConversa): Promise<void> {
    let media = m.media;
    // sem media = tipo que o filtro deixou de fora (áudio, vídeo); com erro = o WAHA não conseguiu baixar
    if (!media) return;
    if (media.mimetype && !ehDocumentoOuImagem(media.mimetype)) return;
    try {
      let conteudo: Buffer | null = null;
      if (media.url && !media.error) conteudo = await this.baixarArquivo(media.url).catch(() => null);
      if (!conteudo) {
        const deNovo = await this.chamar<MensagemApi>(`${caminho}/${encodeURIComponent(m.id)}`, { downloadMedia: true });
        media = deNovo.media ?? media;
        if (!media?.url || media.error) throw new ErroWhatsapp('o WhatsApp não entregou mais esse arquivo');
        conteudo = await this.baixarArquivo(media.url);
      }
      if (!ehDocumentoOuImagem(media.mimetype)) return;
      resumo.midias++;
      await aoArquivo({ id: m.id, quando: m.timestamp, mimetype: media.mimetype ?? '', nomeArquivo: media.filename ?? undefined, conteudo });
    } catch (erro) {
      resumo.falhas.push({ id: m.id, quando: m.timestamp, motivo: erro instanceof Error ? erro.message : String(erro) });
    }
  }

  /** O WAHA monta a URL com o endereço interno dele; o app troca pelo endereço configurado. */
  private async baixarArquivo(url: string): Promise<Buffer> {
    const u = new URL(url, 'http://waha');
    const r = await fetch(this.base() + u.pathname + u.search, { headers: this.cabecalhos(), signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new ErroWhatsapp(`download do arquivo falhou (HTTP ${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }

  private base(): string {
    const url = this.opcoes.url()?.trim();
    if (!url) throw new ErroWhatsapp('Falta o endereço do WAHA (Ajustes → WhatsApp).');
    return url.replace(/\/+$/, '');
  }

  private cabecalhos(): Record<string, string> {
    const chave = this.opcoes.apiKey();
    if (!chave) throw new ErroWhatsapp('Falta a chave da API do WAHA (Ajustes → WhatsApp).');
    return { 'X-Api-Key': chave, Accept: 'application/json' };
  }

  private async chamar<T>(caminho: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
    const url = new URL(this.base() + caminho);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const cabecalhos = this.cabecalhos();

    for (let tentativa = 1; ; tentativa++) {
      let r: Response;
      try {
        r = await fetch(url, { headers: cabecalhos, signal: AbortSignal.timeout(120_000) });
      } catch (erro) {
        if (tentativa < 4) {
          await this.esperar(1000 * 2 ** (tentativa - 1));
          continue;
        }
        throw new ErroWhatsapp(`Não consegui falar com o WAHA: ${erro instanceof Error ? erro.message : String(erro)}`);
      }
      if (r.ok) return (await r.json()) as T;
      if (r.status === 401 || r.status === 403) throw new ErroWhatsapp(`O WAHA recusou a chave da API (HTTP ${r.status}). Confira em Ajustes → WhatsApp.`);
      if (r.status === 404 && caminho.startsWith('/api/sessions/')) throw new ErroWhatsapp(`A sessão "${this.opcoes.sessao()}" não existe no WAHA.`);
      if ((r.status === 429 || r.status >= 500) && tentativa < 4) {
        await this.esperar(1000 * 2 ** (tentativa - 1));
        continue;
      }
      throw new ErroWhatsapp(`O WAHA respondeu HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
  }
}
