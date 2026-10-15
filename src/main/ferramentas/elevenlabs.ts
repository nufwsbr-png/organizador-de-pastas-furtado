import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ErroPausa } from '../job';

export interface PalavraScribe {
  text: string;
  type: 'word' | 'spacing' | 'audio_event';
  start: number;
  end: number;
  speaker_id?: string;
}

export interface RespostaScribe {
  language_code?: string;
  text: string;
  words?: PalavraScribe[];
}

export interface OpcoesElevenLabs {
  baseUrl?: string;
  timeoutMs?: number;
  modelo?: string;
  idioma?: string;
}

function tempo(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Monta o texto da ligação separado por falante ("Falante 1", "Falante 2"…) com a hora de cada fala. */
export function textoPorFalante(resposta: RespostaScribe): string {
  const palavras = (resposta.words ?? []).filter((w) => w.type !== 'audio_event');
  if (palavras.length === 0) return resposta.text.trim();

  const nomes = new Map<string, string>();
  const nome = (id: string | undefined): string => {
    const chave = id ?? 'desconhecido';
    if (!nomes.has(chave)) nomes.set(chave, `Falante ${nomes.size + 1}`);
    return nomes.get(chave)!;
  };

  const blocos: string[] = [];
  let atual: { falante: string; inicio: number; partes: string[] } | null = null;
  for (const w of palavras) {
    const falante = nome(w.speaker_id);
    if (!atual || atual.falante !== falante) {
      if (atual) blocos.push(fecharBloco(atual));
      atual = { falante, inicio: w.start, partes: [] };
    }
    atual.partes.push(w.text);
  }
  if (atual) blocos.push(fecharBloco(atual));
  return blocos.join('\n\n');
}

function fecharBloco(b: { falante: string; inicio: number; partes: string[] }): string {
  const texto = b.partes.join('').replace(/\s+/g, ' ').trim();
  return `[${tempo(b.inicio)}] ${b.falante}: ${texto}`;
}

/** Transcreve um áudio pelo Speech-to-Text do ElevenLabs (Scribe) e devolve o texto por falante. */
export async function transcreverElevenLabs(arquivo: string, chave: string, opcoes: OpcoesElevenLabs = {}): Promise<string> {
  const { baseUrl = 'https://api.elevenlabs.io', timeoutMs = 15 * 60_000, modelo = 'scribe_v2', idioma = 'por' } = opcoes;
  const form = new FormData();
  form.append('model_id', modelo);
  form.append('language_code', idioma);
  form.append('diarize', 'true');
  form.append('num_speakers', '2');
  form.append('timestamps_granularity', 'word');
  form.append('tag_audio_events', 'false');
  form.append('file', new Blob([new Uint8Array(readFileSync(arquivo))]), basename(arquivo));

  let resposta: Response;
  try {
    resposta = await fetch(`${baseUrl}/v1/speech-to-text`, {
      method: 'POST',
      headers: { 'xi-api-key': chave },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (erro) {
    throw new ErroPausa(`Não consegui falar com o ElevenLabs (${erro instanceof Error ? erro.message : String(erro)}). Verifique a internet e tente de novo.`);
  }

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => '');
    const resumo = detalhe.slice(0, 300);
    if (resposta.status === 401) throw new ErroPausa(`Chave do ElevenLabs inválida (401). Confira a chave em Ajustes. ${resumo}`);
    if (resposta.status === 402 || resposta.status === 429) throw new ErroPausa(`O ElevenLabs recusou por limite ou créditos (${resposta.status}). ${resumo}`);
    if (resposta.status >= 500) throw new ErroPausa(`O ElevenLabs está fora do ar (${resposta.status}). Tente de novo mais tarde. ${resumo}`);
    throw new Error(`ElevenLabs recusou o áudio "${basename(arquivo)}" (${resposta.status}): ${resumo}`);
  }

  const dados = (await resposta.json()) as RespostaScribe;
  return textoPorFalante(dados);
}
