import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Etapa } from '../job';
import { PROMPT_RESPOSTAS } from '../prompts';
import type { Provedor } from '../provedores/tipos';
import type { Pergunta } from './perguntas';

export interface Resposta {
  numero: number;
  simNao: 'Sim' | 'Não' | null;
  resposta: string;
  naoRespondida: boolean;
}

export const SCHEMA_RESPOSTAS = {
  type: 'object',
  properties: {
    respostas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          numero: { type: 'integer' },
          simNao: { type: ['string', 'null'], enum: ['Sim', 'Não', null] },
          resposta: { type: 'string' },
          naoRespondida: { type: 'boolean' },
        },
        required: ['numero', 'simNao', 'resposta', 'naoRespondida'],
        additionalProperties: false,
      },
    },
  },
  required: ['respostas'],
  additionalProperties: false,
};

export function formatarPerguntas(perguntas: Pergunta[]): string {
  return perguntas
    .map((p) => `${String(p.numero).padStart(2, '0')}. [${p.secao}] ${p.pergunta}${p.simNao ? ' (Sim/Não)' : ''}`)
    .join('\n');
}

/** Garante uma resposta por pergunta, na ordem; o que faltou vira "não respondida". */
export function completarRespostas(perguntas: Pergunta[], vindas: Resposta[]): Resposta[] {
  return perguntas.map((p) => {
    const r = vindas.find((x) => x.numero === p.numero);
    if (!r) return { numero: p.numero, simNao: null, resposta: '', naoRespondida: true };
    const texto = String(r.resposta ?? '').trim();
    return {
      numero: p.numero,
      simNao: p.simNao && (r.simNao === 'Sim' || r.simNao === 'Não') ? r.simNao : null,
      resposta: texto,
      naoRespondida: Boolean(r.naoRespondida) || (texto === '' && r.simNao == null),
    };
  });
}

export function etapaRespostas(provedor: () => Provedor): Etapa {
  return {
    nome: 'respostas',
    saida: 'respostas.json',
    dependeDe: ['transcricao', 'perguntas'],
    async executar(ctx) {
      const perguntas = JSON.parse(readFileSync(join(ctx.pastaJob, 'perguntas.json'), 'utf8')) as Pergunta[];
      const transcricao = readFileSync(join(ctx.pastaJob, 'transcricao.txt'), 'utf8');
      ctx.log(`Respondendo ${perguntas.length} perguntas com base na transcrição…`);
      const resultado = (await provedor().rodar({
        prompt: PROMPT_RESPOSTAS(formatarPerguntas(perguntas), transcricao),
        schema: SCHEMA_RESPOSTAS,
        imagens: [],
        cwd: ctx.pastaJob,
        nomeTarefa: 'respostas',
      })) as { respostas: Resposta[] };
      const respostas = completarRespostas(perguntas, resultado.respostas ?? []);
      writeFileSync(join(ctx.pastaJob, 'respostas.json'), JSON.stringify(respostas, null, 2));
      const semResposta = respostas.filter((r) => r.naoRespondida).length;
      ctx.log(semResposta > 0 ? `${respostas.length - semResposta} respondidas; ${semResposta} não abordada(s) na ligação.` : 'Todas as perguntas foram respondidas.');
      return { status: 'ok' };
    },
  };
}
