import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { ErroPausa } from '../job';
import { tempo } from './elevenlabs';

export const MODELO_PADRAO = 'mistralai/voxtral-mini-transcribe';
/** Áudio por envio: o OpenRouter aceita até 25 MB e o base64 aumenta um terço. */
const MAX_BYTES = 15 * 1024 * 1024;
/** Duração por envio: o provedor tem 60 s de processamento por pedido. */
const MAX_SEGUNDOS = 10 * 60;

export interface OpcoesOpenRouter {
  baseUrl?: string;
  timeoutMs?: number;
  modelo?: string;
  idioma?: string;
  maxBytes?: number;
  maxSegundos?: number;
}

export interface ParteAudio {
  dados: Buffer;
  formato: string;
  /** Segundo do áudio original em que a parte começa. */
  inicio: number;
}

interface RespostaTranscricao {
  text?: string;
  segments?: { start: number; end: number; text: string }[];
  error?: { message?: string };
}

interface Wav {
  fmt: Buffer;
  dados: Buffer;
  bytesPorSegundo: number;
  bloco: number;
}

/** Lê os blocos "fmt " e "data" de um WAV (PCM ou outro formato de bloco fixo); null se não for WAV. */
function lerWav(buf: Buffer): Wav | null {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let fmt: Buffer | null = null;
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const tamanho = buf.readUInt32LE(pos + 4);
    // gravador que não fecha o arquivo deixa o tamanho do "data" errado: vai até o fim
    const corpo = buf.subarray(pos + 8, Math.min(buf.length, pos + 8 + tamanho));
    if (id === 'fmt ') fmt = corpo;
    if (id === 'data') {
      if (!fmt || fmt.length < 16) return null;
      const bytesPorSegundo = fmt.readUInt32LE(8);
      const bloco = fmt.readUInt16LE(12);
      return bytesPorSegundo && bloco ? { fmt, dados: corpo, bytesPorSegundo, bloco } : null;
    }
    pos += 8 + tamanho + (tamanho % 2);
  }
  return null;
}

function montarWav(fmt: Buffer, dados: Buffer): Buffer {
  const pad = fmt.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
  const cabecalhoFmt = Buffer.alloc(8);
  cabecalhoFmt.write('fmt ', 0, 'ascii');
  cabecalhoFmt.writeUInt32LE(fmt.length, 4);
  const cabecalhoDados = Buffer.alloc(8);
  cabecalhoDados.write('data', 0, 'ascii');
  cabecalhoDados.writeUInt32LE(dados.length, 4);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(4 + 8 + fmt.length + pad.length + 8 + dados.length, 4);
  riff.write('WAVE', 8, 'ascii');
  return Buffer.concat([riff, cabecalhoFmt, fmt, pad, cabecalhoDados, dados]);
}

/**
 * Divide o áudio em partes que cabem num envio. WAV é cortado em pedaços de até `maxSegundos` e `maxBytes`;
 * outros formatos não dá para cortar sem decodificar, então vão inteiros se couberem.
 */
export function partesDoAudio(arquivo: string, dados: Buffer, maxBytes = MAX_BYTES, maxSegundos = MAX_SEGUNDOS): ParteAudio[] {
  const formato = extname(arquivo).slice(1).toLowerCase() || 'wav';
  const wav = formato === 'wav' ? lerWav(dados) : null;
  if (wav) {
    const porTamanho = maxBytes - 64;
    const porTempo = maxSegundos * wav.bytesPorSegundo;
    const passo = Math.max(wav.bloco, Math.floor(Math.min(porTamanho, porTempo) / wav.bloco) * wav.bloco);
    const partes: ParteAudio[] = [];
    for (let i = 0; i < wav.dados.length; i += passo) {
      partes.push({ dados: montarWav(wav.fmt, wav.dados.subarray(i, i + passo)), formato, inicio: i / wav.bytesPorSegundo });
    }
    return partes.length > 0 ? partes : [{ dados, formato, inicio: 0 }];
  }
  if (dados.length > maxBytes) {
    const mb = (n: number) => (n / 1024 / 1024).toFixed(0);
    throw new ErroPausa(
      `O áudio "${basename(arquivo)}" tem ${mb(dados.length)} MB e o OpenRouter aceita até ${mb(maxBytes)} MB por envio em ${formato.toUpperCase()} ` +
        '(em WAV o app divide sozinho). Use o ElevenLabs em Ajustes > Transcrição ou coloque a transcrição na pasta do cliente.',
    );
  }
  return [{ dados, formato, inicio: 0 }];
}

/** Uma linha "[mm:ss] texto" por trecho, com o tempo contado desde o começo do áudio original. */
function textoComTempo(resposta: RespostaTranscricao, inicio: number): string {
  const trechos = (resposta.segments ?? []).filter((s) => s.text.trim());
  if (trechos.length === 0) return (resposta.text ?? '').trim();
  return trechos.map((s) => `[${tempo(inicio + s.start)}] ${s.text.trim()}`).join('\n');
}

/**
 * Transcreve um áudio pelo OpenRouter (padrão: Voxtral mini). Não separa quem fala: cada linha é um trecho
 * com o tempo, ou, em modelo que não dá os trechos, o texto de cada parte com o tempo em que ela começa.
 */
export async function transcreverOpenRouter(arquivo: string, chave: string, opcoes: OpcoesOpenRouter = {}): Promise<string> {
  const { baseUrl = 'https://openrouter.ai/api/v1', timeoutMs = 5 * 60_000, modelo = MODELO_PADRAO, idioma = 'pt', maxBytes, maxSegundos } = opcoes;
  const partes = partesDoAudio(arquivo, readFileSync(arquivo), maxBytes, maxSegundos);
  const textos: string[] = [];
  // pede os trechos com o tempo; modelo que não aceita (ex.: gpt-4o-mini-transcribe) passa para o texto simples
  let comTempo = true;
  for (const [n, parte] of partes.entries()) {
    const qual = partes.length > 1 ? ` (parte ${n + 1} de ${partes.length})` : '';
    const pedir = async (): Promise<{ resposta: Response; corpo: string; dados: RespostaTranscricao }> => {
      let resposta: Response;
      try {
        resposta = await fetch(`${baseUrl}/audio/transcriptions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json', 'X-Title': 'Organizador de pastas' },
          body: JSON.stringify({
            model: modelo,
            input_audio: { data: parte.dados.toString('base64'), format: parte.formato },
            language: idioma,
            ...(comTempo ? { response_format: 'verbose_json', timestamp_granularities: ['segment'] } : { response_format: 'json' }),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (erro) {
        throw new ErroPausa(`Não consegui falar com o OpenRouter${qual} (${erro instanceof Error ? erro.message : String(erro)}). Verifique a internet e tente de novo.`);
      }
      const corpo = await resposta.text().catch(() => '');
      let dados: RespostaTranscricao = {};
      try {
        dados = JSON.parse(corpo) as RespostaTranscricao;
      } catch {
        /* corpo que não é JSON cai nas mensagens abaixo */
      }
      return { resposta, corpo, dados };
    };

    let { resposta, corpo, dados } = await pedir();
    if (comTempo && resposta.status === 400 && /verbose_json|response_format/i.test(dados.error?.message ?? corpo)) {
      comTempo = false;
      ({ resposta, corpo, dados } = await pedir());
    }
    const resumo = (dados.error?.message ?? corpo).slice(0, 300);
    if (resposta.status === 401) throw new ErroPausa(`Chave do OpenRouter inválida (401). Confira a chave em Ajustes. ${resumo}`);
    if (resposta.status === 402) throw new ErroPausa(`O OpenRouter recusou por falta de créditos (402). Coloque créditos na conta e tente de novo. ${resumo}`);
    if (resposta.status === 429) throw new ErroPausa(`O OpenRouter recusou por limite de uso (429). Tente de novo em alguns minutos. ${resumo}`);
    if (resposta.status === 408 || resposta.status >= 500) throw new ErroPausa(`O OpenRouter está fora do ar ou demorou demais${qual} (${resposta.status}). Tente de novo mais tarde. ${resumo}`);
    if (!resposta.ok || dados.error || typeof dados.text !== 'string') {
      throw new Error(`OpenRouter recusou o áudio "${basename(arquivo)}"${qual} (${resposta.status}): ${resumo}`);
    }
    const texto = textoComTempo(dados, parte.inicio);
    // sem trechos com tempo, cada parte ao menos diz onde começa
    textos.push(!dados.segments?.length && partes.length > 1 && texto ? `[${tempo(parte.inicio)}] ${texto}` : texto);
  }
  return textos.filter(Boolean).join('\n');
}

/** Confere a chave no OpenRouter e diz quanto crédito resta nela. */
export async function testarChaveOpenRouter(chave: string, baseUrl = 'https://openrouter.ai/api/v1'): Promise<{ ok: boolean; mensagem: string }> {
  try {
    const r = await fetch(`${baseUrl}/key`, { headers: { Authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(20_000) });
    if (r.status === 401) return { ok: false, mensagem: 'Chave inválida (401).' };
    if (!r.ok) return { ok: false, mensagem: `O OpenRouter respondeu ${r.status}.` };
    const { data } = (await r.json()) as { data?: { limit_remaining?: number | null } };
    const resto = data?.limit_remaining;
    return { ok: true, mensagem: `Chave válida${typeof resto === 'number' ? ` (restam US$ ${resto.toFixed(2)} de limite na chave)` : ''}.` };
  } catch (erro) {
    return { ok: false, mensagem: `Não consegui falar com o OpenRouter: ${erro instanceof Error ? erro.message : String(erro)}` };
  }
}
