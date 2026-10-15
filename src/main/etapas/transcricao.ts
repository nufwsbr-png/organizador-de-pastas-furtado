import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Etapa } from '../job';
import { normalizar } from '../padrao';
import type { Inventario } from './inventario';

export const MENSAGEM_SEM_TRANSCRICAO =
  'Para preencher a entrevista, precisa da transcrição da ligação ou de uma API de transcrição (ElevenLabs). ' +
  'Coloque um arquivo "Transcrição.txt" na pasta do cliente ou a chave do ElevenLabs em Ajustes e clique em Organizar de novo.';

export interface DepsTranscricao {
  /** Chave do ElevenLabs no momento da execução (null = não configurada). */
  chave: () => string | null;
  transcrever: (arquivo: string, chave: string) => Promise<string>;
}

/** Acha um "Transcrição.txt" (com ou sem acento) na raiz da pasta do cliente. */
export function acharTranscricaoManual(pastaCliente: string): string | null {
  for (const nome of readdirSync(pastaCliente)) {
    if (normalizar(nome) === 'transcricao.txt') return join(pastaCliente, nome);
  }
  return null;
}

export function etapaTranscricao(deps: DepsTranscricao): Etapa {
  return {
    nome: 'transcricao',
    saida: 'transcricao.txt',
    async executar(ctx) {
      const inventario = JSON.parse(readFileSync(join(ctx.pastaJob, 'inventario.json'), 'utf8')) as Inventario;
      const pastaCliente = ctx.job.pasta;
      const destino = join(ctx.pastaJob, 'transcricao.txt');

      const manual = acharTranscricaoManual(pastaCliente);
      if (manual) {
        copyFileSync(manual, destino);
        ctx.log(`Usando a transcrição que já estava na pasta (${basename(manual)}).`);
        return { status: 'ok' };
      }

      if (inventario.audios.length === 0) {
        return { status: 'pulada', motivo: 'Sem áudio de ligação na pasta; a entrevista não será preenchida.' };
      }

      const chave = deps.chave();
      if (!chave) return { status: 'pendente', motivo: MENSAGEM_SEM_TRANSCRICAO };

      const partes: string[] = [];
      for (const relativo of inventario.audios) {
        const arquivo = join(pastaCliente, relativo);
        if (!existsSync(arquivo)) continue;
        ctx.log(`Transcrevendo ${relativo}…`);
        const texto = await deps.transcrever(arquivo, chave);
        partes.push(inventario.audios.length > 1 ? `===== ${relativo} =====\n\n${texto}` : texto);
        ctx.log(`Transcrição de ${relativo} pronta (${texto.length} caracteres).`);
      }
      writeFileSync(destino, partes.join('\n\n'));
      return { status: 'ok' };
    },
  };
}
