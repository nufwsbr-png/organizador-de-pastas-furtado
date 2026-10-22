import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Etapa } from '../job';
import { ehPdf, normalizar } from '../padrao';
import { PROMPT_PERGUNTAS } from '../prompts';
import { extrairTexto, rasterizar } from '../ferramentas/pdf';
import type { Provedor } from '../provedores/tipos';
import type { Inventario } from './inventario';

export interface Pergunta {
  numero: number;
  secao: string;
  pergunta: string;
  simNao: boolean;
  /** Resposta que já vem escrita no documento da entrevista (ex.: nome, CPF e empresa no formato "Entrevista guiada"). */
  respostaNoPdf?: string;
}

export interface DadosCliente {
  nome?: string;
  telefone?: string;
  empresa?: string;
  cnpjEmpresa?: string;
  enderecoEmpresa?: string;
  cargo?: string;
  vinculo?: string;
  salario?: string;
  admissao?: string;
  demissao?: string;
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
          respostaNoPdf: { type: 'string' },
        },
        required: ['numero', 'secao', 'pergunta', 'simNao'],
        additionalProperties: false,
      },
    },
    dadosCliente: {
      type: 'object',
      properties: {
        nome: { type: 'string' },
        telefone: { type: 'string' },
        empresa: { type: 'string' },
        cnpjEmpresa: { type: 'string' },
        enderecoEmpresa: { type: 'string' },
        cargo: { type: 'string' },
        vinculo: { type: 'string' },
        salario: { type: 'string' },
        admissao: { type: 'string' },
        demissao: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  required: ['perguntas'],
  additionalProperties: false,
};

/** Resposta já escrita no documento, ou undefined se o campo está vazio (o formato "Entrevista guiada" usa "R: ."). */
export function limparRespostaNoPdf(texto: unknown): string | undefined {
  const t = typeof texto === 'string' ? texto.trim() : '';
  return /^[\s.\-–—_]*$/.test(t) ? undefined : t;
}

/** Numeração que recomeça em cada seção (1, 2, 3 · 1, 2…) vira contínua; qualquer outra falha fica para validarPerguntas. */
export function numerarEmSequencia(perguntas: Pergunta[]): Pergunta[] {
  const porSecao = perguntas.every((p, i) => p.numero === (i === 0 || perguntas[i - 1].secao !== p.secao ? 1 : perguntas[i - 1].numero + 1));
  return porSecao ? perguntas.map((p, i) => ({ ...p, numero: i + 1 })) : perguntas;
}

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

/** PDF da entrevista com outro nome (ex.: "1700000000000-0a1b2c3d.pdf"): reconhece pelo texto da primeira página. */
export async function acharPdfPerguntasPeloTexto(pasta: string, inventario: Inventario): Promise<string | null> {
  for (const a of inventario.arquivos) {
    if (a.situacao !== 'classificar' || !ehPdf(a.relativo)) continue;
    try {
      const texto = normalizar(await extrairTexto(join(pasta, a.relativo), 1));
      if (texto.includes('entrevista guiada') || (texto.includes('entrevista') && texto.includes('nome do cliente'))) return a.relativo;
    } catch {
      /* PDF que não abre não é a entrevista */
    }
  }
  return null;
}

export function etapaPerguntas(provedor: () => Provedor): Etapa {
  return {
    nome: 'perguntas',
    saida: 'perguntas.json',
    async executar(ctx) {
      const inventario = JSON.parse(readFileSync(join(ctx.pastaJob, 'inventario.json'), 'utf8')) as Inventario;
      const relativo = acharPdfPerguntas(inventario) ?? (await acharPdfPerguntasPeloTexto(ctx.job.pasta, inventario));
      if (!relativo) {
        return { status: 'pendente', motivo: 'Não achei o PDF com as perguntas da entrevista na pasta (ex.: "Perguntas entrevista.pdf").' };
      }
      const pdf = join(ctx.job.pasta, relativo);
      ctx.log(`Lendo as perguntas de ${relativo}…`);
      const imagens = await rasterizar(pdf, join(ctx.pastaJob, 'perguntas-png'), { maxPaginas: 30, escala: 1.5 });
      // o formato "Entrevista guiada" é PDF com texto; os prints do sistema não têm (só as imagens)
      const texto = (await extrairTexto(pdf, 30).catch(() => '')).trim();
      const resultado = (await provedor().rodar({
        prompt: PROMPT_PERGUNTAS(imagens, texto.length >= 200 ? texto.slice(0, 30_000) : ''),
        schema: SCHEMA_PERGUNTAS,
        imagens,
        cwd: ctx.pastaJob,
        nomeTarefa: 'perguntas',
      })) as { perguntas: Pergunta[]; dadosCliente?: DadosCliente };

      const perguntas = numerarEmSequencia(
        (resultado.perguntas ?? []).map((p) => {
          const respostaNoPdf = limparRespostaNoPdf(p.respostaNoPdf);
          return { numero: p.numero, secao: String(p.secao ?? '').trim(), pergunta: String(p.pergunta).trim(), simNao: p.simNao, ...(respostaNoPdf ? { respostaNoPdf } : {}) };
        }),
      );
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
