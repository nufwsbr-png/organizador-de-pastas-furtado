import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Fila, Job } from './fila';

/** Erro que pausa o job (limite da assinatura, API fora, chave inválida) em vez de marcá-lo como erro. */
export class ErroPausa extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroPausa';
  }
}

export type ResultadoEtapa =
  | { status: 'ok' }
  | { status: 'pendente'; motivo: string }
  | { status: 'pulada'; motivo: string };

export interface Contexto {
  fila: Fila;
  /** Pasta de trabalho do job (saídas intermediárias). */
  pastaJob: string;
  job: Job;
  log: (texto: string, nivel?: 'info' | 'aviso' | 'erro') => void;
}

export interface Etapa {
  nome: string;
  /** Arquivo em pastaJob que marca a etapa como feita (se existir, a etapa é pulada). */
  saida: string;
  /** Etapas que precisam ter terminado com 'ok' para esta rodar. */
  dependeDe?: string[];
  executar(ctx: Contexto): Promise<ResultadoEtapa>;
}

/**
 * Roda as etapas em ordem. Retomada: etapa cuja saída já existe é pulada.
 * Etapa pendente não interrompe as outras, só as que dependem dela.
 */
export async function executarJob(id: string, etapas: Etapa[], base: { fila: Fila; pastaJob: string }): Promise<Job> {
  const { fila, pastaJob } = base;
  mkdirSync(pastaJob, { recursive: true });
  const log: Contexto['log'] = (texto, nivel = 'info') => fila.mensagem(id, texto, nivel);
  fila.atualizar(id, { estado: 'rodando', motivo: undefined });

  const concluidas = new Set<string>();
  const pendentes: string[] = [];
  const motivos: string[] = [];

  try {
    for (const etapa of etapas) {
      const job = fila.obter(id)!;
      const ctx: Contexto = { fila, pastaJob, job, log };
      const faltando = (etapa.dependeDe ?? []).filter((d) => !concluidas.has(d));
      if (faltando.length > 0) {
        pendentes.push(etapa.nome);
        continue;
      }
      if (existsSync(join(pastaJob, etapa.saida))) {
        concluidas.add(etapa.nome);
        continue;
      }
      fila.atualizar(id, { etapa: etapa.nome });
      const resultado = await etapa.executar(ctx);
      if (resultado.status === 'ok') {
        concluidas.add(etapa.nome);
      } else if (resultado.status === 'pendente') {
        pendentes.push(etapa.nome);
        motivos.push(resultado.motivo);
        log(resultado.motivo, 'aviso');
      } else {
        concluidas.add(etapa.nome);
        log(resultado.motivo);
      }
      fila.atualizar(id, { etapasConcluidas: [...concluidas], etapasPendentes: [...pendentes] });
    }
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    const estado = erro instanceof ErroPausa ? 'pausado' : 'erro';
    log(mensagem, 'erro');
    return fila.atualizar(id, { estado, motivo: mensagem, etapasConcluidas: [...concluidas], etapasPendentes: [...pendentes] });
  }

  const estado = pendentes.length > 0 ? 'atencao' : 'concluido';
  return fila.atualizar(id, {
    estado,
    etapa: null,
    motivo: motivos.length > 0 ? motivos.join(' ') : undefined,
    etapasConcluidas: [...concluidas],
    etapasPendentes: [...pendentes],
  });
}
