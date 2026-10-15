import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { Etapa } from '../job';
import { DOCUMENTOS_PADRAO, ehImagem, ehPdf, nomeFinal } from '../padrao';
import { PROMPT_CLASSIFICAR } from '../prompts';
import { extrairTexto, rasterizar } from '../ferramentas/pdf';
import type { Provedor } from '../provedores/tipos';
import type { ArquivoInventariado, Inventario } from './inventario';

export interface Classificacao {
  id: number;
  tipo: string;
  grupo: string | null;
  ordem: number;
}

export interface Movimento {
  origem: string;
  destino: string;
  tipo: string;
}

export interface JuntarImagens {
  origens: string[];
  destino: string;
  tipo: string;
}

export interface CopiarDoJob {
  /** Arquivo dentro da pasta do job. */
  origem: string;
  destino: string;
}

export interface PlanoMovimentos {
  movimentos: Movimento[];
  juntarImagens: JuntarImagens[];
  copiarDoJob: CopiarDoJob[];
}

export interface ItemParaIA {
  id: number;
  relativo: string;
  texto: string;
  imagens: string[];
}

const TIPOS_IA = ['Procuração', 'Declaração', 'RG', 'CNH', 'CTPS', 'Contrato Trabalhista', 'Comprovante de residência', 'Perguntas entrevista', 'outro'];

export const SCHEMA_CLASSIFICAR = {
  type: 'object',
  properties: {
    arquivos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          tipo: { type: 'string', enum: TIPOS_IA },
          grupo: { type: ['string', 'null'] },
          ordem: { type: 'integer' },
        },
        required: ['id', 'tipo', 'grupo', 'ordem'],
        additionalProperties: false,
      },
    },
  },
  required: ['arquivos'],
  additionalProperties: false,
};

export function montarItens(itens: ItemParaIA[]): string {
  return itens
    .map((i) => {
      const linhas = [`[id: ${i.id}] ${i.relativo}`];
      if (i.texto.trim()) linhas.push(`Texto (início): """${i.texto.trim().slice(0, 1500)}"""`);
      if (i.imagens.length > 0) linhas.push(`Imagens para olhar: ${i.imagens.join(' ; ')}`);
      if (!i.texto.trim() && i.imagens.length === 0) linhas.push('(sem texto legível e sem imagem; julgue pelo nome)');
      return linhas.join('\n');
    })
    .join('\n\n');
}

/** Monta o plano de movimentos a partir do inventário e da classificação da IA. */
export function planejarMovimentos(
  arquivos: ArquivoInventariado[],
  classificacoes: Classificacao[],
  idParaRelativo: Record<number, string>,
  temEntrevistaPreenchida: boolean,
): PlanoMovimentos {
  const plano: PlanoMovimentos = { movimentos: [], juntarImagens: [], copiarDoJob: [] };
  const ocupados = new Set<string>();
  for (const a of arquivos) if (a.situacao === 'no-lugar') ocupados.add(a.tipo);

  const paraRevisar = (relativo: string, tipo: string) => plano.movimentos.push({ origem: relativo, destino: `Revisar/${basename(relativo)}`, tipo });

  // 1. Arquivos com nome padrão fora do lugar.
  let audios = 0;
  for (const a of arquivos) {
    if (a.situacao !== 'mover') continue;
    const ext = extname(a.relativo);
    if (a.tipo === 'Áudio da ligação') {
      audios++;
      const base = nomeFinal(a.tipo, ext);
      const destino = audios === 1 && !ocupados.has(a.tipo) ? base : base.replace(ext.toLowerCase(), ` ${audios + (ocupados.has(a.tipo) ? 1 : 0)}${ext.toLowerCase()}`);
      plano.movimentos.push({ origem: a.relativo, destino, tipo: a.tipo });
      continue;
    }
    if (ocupados.has(a.tipo)) {
      paraRevisar(a.relativo, a.tipo);
      continue;
    }
    ocupados.add(a.tipo);
    plano.movimentos.push({ origem: a.relativo, destino: nomeFinal(a.tipo, ext), tipo: a.tipo });
  }

  // 2. Classificados pela IA: grupos de imagens viram um PDF; PDFs só mudam de lugar.
  const porGrupo = new Map<string, Classificacao[]>();
  const soltos: Classificacao[] = [];
  for (const c of classificacoes) {
    const relativo = idParaRelativo[c.id];
    if (!relativo) continue;
    if (c.grupo && c.tipo !== 'outro') {
      const chave = `${c.tipo}::${c.grupo}`;
      porGrupo.set(chave, [...(porGrupo.get(chave) ?? []), c]);
    } else soltos.push(c);
  }

  const destinoOuRevisar = (tipo: string, relativos: string[], comoPdf: boolean) => {
    const conhecido = DOCUMENTOS_PADRAO.some((d) => d.nome === tipo);
    if (!conhecido || tipo === 'outro' || ocupados.has(tipo)) {
      for (const r of relativos) paraRevisar(r, tipo);
      return;
    }
    ocupados.add(tipo);
    if (comoPdf) plano.juntarImagens.push({ origens: relativos, destino: nomeFinal(tipo, '.pdf'), tipo });
    else plano.movimentos.push({ origem: relativos[0], destino: nomeFinal(tipo, extname(relativos[0])), tipo });
  };

  for (const [, membros] of porGrupo) {
    membros.sort((x, y) => x.ordem - y.ordem);
    const relativos = membros.map((m) => idParaRelativo[m.id]);
    const todasImagens = relativos.every((r) => ehImagem(r));
    if (todasImagens) destinoOuRevisar(membros[0].tipo, relativos, true);
    else {
      // grupo misto (PDF + imagem): o primeiro PDF fica com o tipo, o resto vai para Revisar
      const pdf = relativos.find((r) => ehPdf(r))!;
      destinoOuRevisar(membros[0].tipo, [pdf], false);
      for (const r of relativos) if (r !== pdf) paraRevisar(r, membros[0].tipo);
    }
  }
  for (const c of soltos) {
    const relativo = idParaRelativo[c.id];
    if (ehImagem(relativo)) destinoOuRevisar(c.tipo, [relativo], true);
    else if (ehPdf(relativo)) destinoOuRevisar(c.tipo, [relativo], false);
    else paraRevisar(relativo, c.tipo);
  }

  if (temEntrevistaPreenchida) {
    plano.copiarDoJob.push({ origem: 'Entrevista preenchida.pdf', destino: nomeFinal('Entrevista preenchida', '.pdf') });
  }
  return plano;
}

export function etapaClassificar(provedor: () => Provedor): Etapa {
  return {
    nome: 'classificar',
    saida: 'plano-movimentos.json',
    async executar(ctx) {
      const inventario = JSON.parse(readFileSync(join(ctx.pastaJob, 'inventario.json'), 'utf8')) as Inventario;
      const pendentes = inventario.arquivos.filter((a) => a.situacao === 'classificar');
      const idParaRelativo: Record<number, string> = {};
      const itens: ItemParaIA[] = [];
      const imagens: string[] = [];

      for (let id = 0; id < pendentes.length; id++) {
        const a = pendentes[id];
        idParaRelativo[id] = a.relativo;
        const caminho = join(ctx.job.pasta, a.relativo);
        const item: ItemParaIA = { id, relativo: a.relativo, texto: '', imagens: [] };
        try {
          if (ehPdf(a.relativo)) {
            item.texto = await extrairTexto(caminho, 3);
            if (item.texto.trim().length < 50) {
              item.imagens = await rasterizar(caminho, join(ctx.pastaJob, 'digest', String(id)), { maxPaginas: 2, escala: 1.2 });
            }
          } else if (ehImagem(a.relativo)) {
            item.imagens = [caminho];
          }
        } catch (erro) {
          ctx.log(`Não consegui ler ${a.relativo} (${erro instanceof Error ? erro.message : String(erro)}); vai para Revisar.`, 'aviso');
        }
        imagens.push(...item.imagens);
        itens.push(item);
      }

      let classificacoes: Classificacao[] = [];
      if (itens.length > 0) {
        ctx.log(`Classificando ${itens.length} arquivo(s) com a IA…`);
        const resultado = (await provedor().rodar({
          prompt: PROMPT_CLASSIFICAR(montarItens(itens)),
          schema: SCHEMA_CLASSIFICAR,
          imagens,
          cwd: ctx.job.pasta,
          nomeTarefa: 'classificar',
        })) as { arquivos: Classificacao[] };
        classificacoes = resultado.arquivos ?? [];
        // o que a IA não devolveu vai para Revisar
        for (const i of itens) if (!classificacoes.some((c) => c.id === i.id)) classificacoes.push({ id: i.id, tipo: 'outro', grupo: null, ordem: 1 });
      }

      const temEntrevista = existsSyncSeguro(join(ctx.pastaJob, 'Entrevista preenchida.pdf'));
      const plano = planejarMovimentos(inventario.arquivos, classificacoes, idParaRelativo, temEntrevista);
      writeFileSync(join(ctx.pastaJob, 'plano-movimentos.json'), JSON.stringify(plano, null, 2));
      const revisar = plano.movimentos.filter((m) => m.destino.startsWith('Revisar/')).length;
      ctx.log(`Plano pronto: ${plano.movimentos.length} movimento(s), ${plano.juntarImagens.length} PDF(s) a montar de imagens${revisar > 0 ? `, ${revisar} para Revisar` : ''}.`);
      return { status: 'ok' };
    },
  };
}

function existsSyncSeguro(p: string): boolean {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}
