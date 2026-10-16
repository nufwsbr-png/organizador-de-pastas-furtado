import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Etapa } from '../job';
import { normalizar } from '../padrao';
import { PROMPT_PERGUNTAS } from '../prompts';
import { rasterizar } from '../ferramentas/pdf';
import type { Provedor } from '../provedores/tipos';
import type { Inventario } from './inventario';

export interface Pergunta {
  numero: number;
  secao: string;
  pergunta: string;
  simNao: boolean;
}

export interface DadosCliente {
  nome?: string;
  empresa?: string;
  cargo?: string;
  vinculo?: string;
  salario?: string;
}

export const SCHEMA_PERGUNTAS = {
  type: 'object',
  properties: {
    perguntas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          numero: { type: 'integer' },
          secao: { type: 'string' },
          pergunta: { type: 'string' },
          simNao: { type: 'boolean' },
        },
        required: ['numero', 'secao', 'pergunta', 'simNao'],
        additionalProperties: false,
      },
    },
    dadosCliente: {
      type: 'object',
      properties: {
        nome: { type: 'string' },
        empresa: { type: 'string' },
        cargo: { type: 'string' },
        vinculo: { type: 'string' },
        salario: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  required: ['perguntas'],
  additionalProperties: false,
};

/** Devolve null se a lista está boa, ou o problema encontrado. */
export function validarPerguntas(perguntas: Pergunta[]): string | null {
  if (perguntas.length === 0) return 'A IA não encontrou nenhuma pergunta no PDF.';
  for (let i = 0; i < perguntas.length; i++) {
    if (perguntas[i].numero !== i + 1) return `A numeração das perguntas veio com falha (esperava ${i + 1}, veio ${perguntas[i].numero}).`;
    if (!perguntas[i].pergunta.trim()) return `A pergunta ${i + 1} veio vazia.`;
  }
  return null;
}

/** Acha o PDF de perguntas no inventário: o nome padrão ou qualquer PDF com "pergunta"/"entrevista" no nome. */
export function acharPdfPerguntas(inventario: Inventario): string | null {
  if (inventario.perguntas) return inventario.perguntas;
  const candidato = inventario.arquivos.find((a) => {
    const n = normalizar(a.relativo);
    return n.endsWith('.pdf') && (n.includes('pergunta') || n.includes('entrevista')) && !n.includes('preenchida') && a.situacao !== 'ignorar';
  });
  return candidato?.relativo ?? null;
}

export function etapaPerguntas(provedor: () => Provedor): Etapa {
  return {
    nome: 'perguntas',
    saida: 'perguntas.json',
    async executar(ctx) {
      const inventario = JSON.parse(readFileSync(join(ctx.pastaJob, 'inventario.json'), 'utf8')) as Inventario;
      const relativo = acharPdfPerguntas(inventario);
      if (!relativo) {
        return { status: 'pendente', motivo: 'Não achei o PDF com as perguntas da entrevista na pasta (ex.: "Perguntas entrevista.pdf").' };
      }
      const pdf = join(ctx.job.pasta, relativo);
      ctx.log(`Lendo as perguntas de ${relativo}…`);
      const imagens = await rasterizar(pdf, join(ctx.pastaJob, 'perguntas-png'), { maxPaginas: 30, escala: 1.5 });
      const resultado = (await provedor().rodar({
        prompt: PROMPT_PERGUNTAS(imagens),
        schema: SCHEMA_PERGUNTAS,
        imagens,
        cwd: ctx.pastaJob,
        nomeTarefa: 'perguntas',
      })) as { perguntas: Pergunta[]; dadosCliente?: DadosCliente };

      const perguntas = (resultado.perguntas ?? []).map((p) => ({ ...p, pergunta: String(p.pergunta).trim(), secao: String(p.secao ?? '').trim() }));
      const problema = validarPerguntas(perguntas);
      if (problema) return { status: 'pendente', motivo: `${problema} Clique em Organizar de novo para tentar outra vez.` };

      const dadosCliente = Object.fromEntries(Object.entries(resultado.dadosCliente ?? {}).filter(([, v]) => typeof v === 'string' && v.trim()));
      if (Object.keys(dadosCliente).length > 0) writeFileSync(join(ctx.pastaJob, 'dados-cliente.json'), JSON.stringify(dadosCliente, null, 2));
      writeFileSync(join(ctx.pastaJob, 'perguntas.json'), JSON.stringify(perguntas, null, 2));
      ctx.log(`${perguntas.length} perguntas encontradas.`);
      return { status: 'ok' };
    },
  };
}
