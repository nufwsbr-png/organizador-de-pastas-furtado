import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Etapa } from '../job';
import { lerDocumentoTexto } from '../ferramentas/texto';
import type { Inventario } from './inventario';

export const MENSAGEM_SEM_TRANSCRICAO =
  'Para preencher a entrevista, precisa da transcrição da ligação ou de uma API de transcrição (ElevenLabs). ' +
  'Coloque na pasta do cliente um arquivo com a transcrição (txt, docx ou pdf, com "Transcrição" no nome) ou a chave do ElevenLabs em Ajustes e clique em Organizar de novo.';

export interface DepsTranscricao {
  /** Chave do ElevenLabs no momento da execução (null = não configurada). */
  chave: () => string | null;
  transcrever: (arquivo: string, chave: string) => Promise<string>;
}

/** Acha uma transcrição pronta (txt, docx, pdf com "transcri" no nome) em qualquer pasta do cliente; devolve o caminho relativo. */
export function acharTranscricaoManual(inventario: Inventario): string | null {
  const candidatos = inventario.arquivos.filter((a) => a.situacao !== 'ignorar' && a.situacao !== 'classificar' && a.tipo === 'Transcrição');
  // prioridade: já na pasta Entrevista, depois txt (mais fiel), depois o resto
  const peso = (a: (typeof candidatos)[number]) => (a.situacao === 'no-lugar' ? 2 : 0) + (a.relativo.toLowerCase().endsWith('.txt') ? 1 : 0);
  candidatos.sort((a, b) => peso(b) - peso(a));
  return candidatos[0]?.relativo ?? null;
}

export function etapaTranscricao(deps: DepsTranscricao): Etapa {
  return {
    nome: 'transcricao',
    saida: 'transcricao.txt',
    async executar(ctx) {
      const inventario = JSON.parse(readFileSync(join(ctx.pastaJob, 'inventario.json'), 'utf8')) as Inventario;
      const pastaCliente = ctx.job.pasta;
      const destino = join(ctx.pastaJob, 'transcricao.txt');

      const manual = acharTranscricaoManual(inventario);
      if (manual && existsSync(join(pastaCliente, manual))) {
        const texto = (await lerDocumentoTexto(join(pastaCliente, manual))).trim();
        if (texto.length === 0) {
          return { status: 'pendente', motivo: `A transcrição ${manual} está vazia ou não deu para ler o texto. Confira o arquivo e clique em Organizar de novo.` };
        }
        writeFileSync(destino, texto);
        ctx.log(`Usando a transcrição que já estava na pasta (${manual}).`);
        return { status: 'ok' };
      }

      if (inventario.audios.length === 0) {
        return { status: 'pulada', motivo: 'Sem áudio de ligação na pasta; a entrevista não será preenchida.' };
      }

      const chave = deps.chave();
      if (!chave) return { status: 'pendente', motivo: MENSAGEM_SEM_TRANSCRICAO };

      const partes: string[] = [];
      for (let n = 0; n < inventario.audios.length; n++) {
        const relativo = inventario.audios[n];
        const arquivo = join(pastaCliente, relativo);
        if (!existsSync(arquivo)) continue;
        // cada áudio transcrito fica guardado: se o próximo falhar, este não é cobrado de novo
        const cache = join(ctx.pastaJob, `transcricao-${n + 1}.txt`);
        let texto: string;
        if (existsSync(cache)) {
          texto = readFileSync(cache, 'utf8');
        } else {
          ctx.log(`Transcrevendo ${relativo}…`);
          texto = await deps.transcrever(arquivo, chave);
          writeFileSync(cache, texto);
          ctx.log(`Transcrição de ${relativo} pronta (${texto.length} caracteres).`);
        }
        partes.push(inventario.audios.length > 1 ? `===== ${relativo} =====\n\n${texto}` : texto);
      }
      writeFileSync(destino, partes.join('\n\n'));
      return { status: 'ok' };
    },
  };
}
