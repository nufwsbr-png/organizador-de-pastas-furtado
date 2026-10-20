import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Fila, type Job } from './fila';
import { executarJob, type Etapa } from './job';
import { Semaforo } from './semaforo';

export interface OpcoesOrquestrador {
  userData: string;
  paralelismo: () => number;
  etapas: () => Etapa[];
  /** Chamado antes de cada execução (ex.: apagar o inventário para reler a pasta). */
  antesDeRodar?: (pastaJob: string) => void;
}

/** Dono da fila: decide o que roda, quantos ao mesmo tempo, e retoma o que ficou pela metade. */
export class Orquestrador {
  readonly fila: Fila;
  private rodando = new Set<string>();
  private semaforo: Semaforo;

  constructor(private opcoes: OpcoesOrquestrador) {
    mkdirSync(opcoes.userData, { recursive: true });
    this.fila = new Fila(join(opcoes.userData, 'jobs.json'));
    this.semaforo = new Semaforo(opcoes.paralelismo());
  }

  pastaJob(id: string): string {
    return join(this.opcoes.userData, 'jobs', id);
  }

  jobs(): Job[] {
    return this.fila.listar();
  }

  adicionarPasta(pasta: string): Job {
    const job = this.fila.adicionar(pasta);
    mkdirSync(this.pastaJob(job.id), { recursive: true });
    return job;
  }

  estaRodando(id: string): boolean {
    return this.rodando.has(id);
  }

  remover(id: string): void {
    if (this.rodando.has(id)) throw new Error('Essa pasta está sendo organizada agora; espere terminar.');
    this.fila.remover(id);
    rmSync(this.pastaJob(id), { recursive: true, force: true });
  }

  /** Tira da lista as pastas concluídas (não mexe nos arquivos do cliente). */
  limparConcluidas(): void {
    for (const j of this.jobs()) if (j.estado === 'concluido' && !this.rodando.has(j.id)) this.remover(j.id);
  }

  /** Apaga as saídas do job (menos a transcrição, que custa dinheiro) e coloca de volta na fila. */
  refazer(id: string): void {
    if (this.rodando.has(id)) throw new Error('Essa pasta está sendo organizada agora; espere terminar.');
    const pasta = this.pastaJob(id);
    if (existsSync(pasta)) {
      for (const nome of readdirSync(pasta)) {
        if (nome === 'transcricao.txt') continue;
        rmSync(join(pasta, nome), { recursive: true, force: true });
      }
    }
    this.fila.atualizar(id, { estado: 'na-fila', etapa: null, etapasConcluidas: [], etapasPendentes: [], motivo: undefined, mensagens: [] });
  }

  async organizar(id: string): Promise<void> {
    if (this.rodando.has(id)) return;
    const job = this.fila.obter(id);
    if (!job) return;
    this.rodando.add(id);
    this.semaforo.limite = Math.max(1, this.opcoes.paralelismo());
    this.fila.atualizar(id, { estado: 'aguardando', etapa: null, motivo: undefined });
    try {
      this.opcoes.antesDeRodar?.(this.pastaJob(id));
      await this.semaforo.executar(() => executarJob(id, this.opcoes.etapas(), { fila: this.fila, pastaJob: this.pastaJob(id) }));
    } finally {
      this.rodando.delete(id);
    }
  }

  /** Organiza tudo que não está rodando nem concluído. */
  organizarTudo(): Promise<void> {
    const alvos = this.jobs().filter((j) => !this.rodando.has(j.id) && j.estado !== 'concluido');
    return Promise.all(alvos.map((j) => this.organizar(j.id))).then(() => undefined);
  }

  /** Ao abrir o app: continua o que ficou na fila quando ele fechou. */
  retomarPendentes(): Promise<void> {
    const alvos = this.jobs().filter((j) => j.estado === 'na-fila' && !this.rodando.has(j.id));
    return Promise.all(alvos.map((j) => this.organizar(j.id))).then(() => undefined);
  }
}
