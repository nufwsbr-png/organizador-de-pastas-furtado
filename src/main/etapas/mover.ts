import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import type { Etapa } from '../job';
import { imagensParaPdf } from '../ferramentas/imagem';
import type { PlanoMovimentos } from './classificar';
import { PASTA_WHATSAPP } from './whatsapp';

export interface Feito {
  acao: 'mover' | 'juntar' | 'copiar' | 'substituido';
  de: string;
  para: string;
}

/** Tira um arquivo do caminho sem apagar: vai para _substituidos/<caminho relativo>. */
export function guardarEmSubstituidos(pastaCliente: string, relativo: string, feitos: Feito[]): void {
  const origem = join(pastaCliente, relativo);
  if (!existsSync(origem)) return;
  let destinoRel = `_substituidos/${relativo}`;
  if (existsSync(join(pastaCliente, destinoRel))) {
    const ext = extname(relativo);
    destinoRel = `_substituidos/${relativo.slice(0, relativo.length - ext.length)} (${Date.now()})${ext}`;
  }
  mkdirSync(dirname(join(pastaCliente, destinoRel)), { recursive: true });
  renameSync(origem, join(pastaCliente, destinoRel));
  feitos.push({ acao: 'substituido', de: relativo, para: destinoRel });
}

function mesmoConteudo(a: string, b: string): boolean {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

/** Apaga a pasta se não sobrou nenhum arquivo nela (só subpastas vazias). */
function removerSeVazia(pasta: string): void {
  if (!existsSync(pasta)) return;
  const temArquivo = (dir: string): boolean => readdirSync(dir, { withFileTypes: true }).some((e) => (e.isDirectory() ? temArquivo(join(dir, e.name)) : true));
  if (!temArquivo(pasta)) rmSync(pasta, { recursive: true, force: true });
}

/** Executa o plano na pasta do cliente. Nunca apaga: o que sai do caminho vai para _substituidos. */
export async function aplicarPlano(
  pastaCliente: string,
  plano: PlanoMovimentos,
  pastaJob: string,
  log: (texto: string) => void,
): Promise<Feito[]> {
  const feitos: Feito[] = [];

  for (const m of plano.movimentos) {
    const origem = join(pastaCliente, m.origem);
    if (!existsSync(origem)) continue; // já movido numa execução anterior
    const destino = join(pastaCliente, m.destino);
    if (existsSync(destino)) {
      if (mesmoConteudo(origem, destino)) {
        guardarEmSubstituidos(pastaCliente, m.origem, feitos);
        continue;
      }
      guardarEmSubstituidos(pastaCliente, m.destino, feitos);
    }
    mkdirSync(dirname(destino), { recursive: true });
    renameSync(origem, destino);
    feitos.push({ acao: 'mover', de: m.origem, para: m.destino });
    log(`${m.origem} → ${m.destino}`);
  }

  for (const j of plano.juntarImagens) {
    const origens = j.origens.map((o) => join(pastaCliente, o)).filter((o) => existsSync(o));
    if (origens.length === 0) continue;
    const destino = join(pastaCliente, j.destino);
    if (existsSync(destino)) guardarEmSubstituidos(pastaCliente, j.destino, feitos);
    mkdirSync(dirname(destino), { recursive: true });
    await imagensParaPdf(origens, destino);
    feitos.push({ acao: 'juntar', de: j.origens.join(' + '), para: j.destino });
    log(`${j.origens.join(' + ')} → ${j.destino}`);
    for (const o of j.origens) guardarEmSubstituidos(pastaCliente, o, feitos);
  }

  for (const c of plano.copiarDoJob) {
    const origem = join(pastaJob, c.origem);
    if (!existsSync(origem)) continue;
    const destino = join(pastaCliente, c.destino);
    if (existsSync(destino)) {
      if (mesmoConteudo(origem, destino)) continue;
      guardarEmSubstituidos(pastaCliente, c.destino, feitos);
    }
    mkdirSync(dirname(destino), { recursive: true });
    copyFileSync(origem, destino);
    feitos.push({ acao: 'copiar', de: c.origem, para: c.destino });
    log(`${c.origem} → ${c.destino}`);
  }

  return feitos;
}

export function etapaMover(): Etapa {
  return {
    nome: 'mover',
    saida: 'movimentos.json',
    dependeDe: ['classificar'],
    async executar(ctx) {
      const plano = JSON.parse(readFileSync(join(ctx.pastaJob, 'plano-movimentos.json'), 'utf8')) as PlanoMovimentos;
      const feitos = await aplicarPlano(ctx.job.pasta, plano, ctx.pastaJob, ctx.log);
      removerSeVazia(join(ctx.job.pasta, PASTA_WHATSAPP));
      writeFileSync(join(ctx.pastaJob, 'movimentos.json'), JSON.stringify({ feitos, quando: new Date().toISOString() }, null, 2));
      const revisar = plano.movimentos.filter((m) => m.destino.startsWith('Revisar/')).length;
      if (revisar > 0) ctx.log(`${revisar} arquivo(s) ficaram em "Revisar" porque não deu para identificar. Confira manualmente.`, 'aviso');
      ctx.log(`Pasta organizada: ${feitos.length} ação(ões).`);
      return { status: 'ok' };
    },
  };
}
