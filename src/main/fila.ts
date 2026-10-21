import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

/** `aguardando` = mandado organizar, esperando uma vaga (paralelismo); `rodando` = organizando agora. */
export type EstadoJob = 'na-fila' | 'aguardando' | 'rodando' | 'pausado' | 'atencao' | 'concluido' | 'erro';
export type NivelMensagem = 'info' | 'aviso' | 'erro';

export interface Mensagem {
  quando: string;
  nivel: NivelMensagem;
  texto: string;
}

export interface Job {
  id: string;
  pasta: string;
  nome: string;
  estado: EstadoJob;
  /** Etapa em andamento (ou a última tocada). */
  etapa: string | null;
  etapasConcluidas: string[];
  etapasPendentes: string[];
  mensagens: Mensagem[];
  motivo?: string;
  /** Nome, e-mail ou link do cliente no ZapSign, quando o nome da pasta não serve para achar o envelope. */
  buscaZapsign?: string;
  /** Nome e telefone informados na tela quando o app não consegue confirmar o cliente sozinho. */
  cliente?: { nome?: string; telefone?: string };
  criadoEm: string;
  atualizadoEm: string;
}

interface Arquivo {
  jobs: Job[];
}

/** Fila de pastas a organizar, gravada em disco (jobs.json) a cada mudança. */
export class Fila {
  private jobs: Job[] = [];
  private ouvintes = new Set<(jobs: Job[]) => void>();

  constructor(private arquivo: string) {
    this.carregar();
  }

  /** Lê o arquivo; jobs que estavam rodando voltam para a fila (retomada após fechar o app). */
  private carregar(): void {
    if (!existsSync(this.arquivo)) return;
    try {
      const dados = JSON.parse(readFileSync(this.arquivo, 'utf8')) as Arquivo;
      this.jobs = (dados.jobs ?? []).map((j) => ({
        ...j,
        etapasPendentes: j.etapasPendentes ?? [],
        mensagens: j.mensagens ?? [],
        estado: j.estado === 'rodando' || j.estado === 'aguardando' ? 'na-fila' : j.estado,
      }));
    } catch {
      this.jobs = [];
    }
  }

  private salvar(): void {
    mkdirSync(dirname(this.arquivo), { recursive: true });
    const tmp = `${this.arquivo}.tmp`;
    writeFileSync(tmp, JSON.stringify({ jobs: this.jobs } satisfies Arquivo, null, 2));
    renameSync(tmp, this.arquivo);
    for (const o of this.ouvintes) o(this.listar());
  }

  aoMudar(ouvinte: (jobs: Job[]) => void): () => void {
    this.ouvintes.add(ouvinte);
    return () => this.ouvintes.delete(ouvinte);
  }

  listar(): Job[] {
    return this.jobs.map((j) => ({ ...j }));
  }

  obter(id: string): Job | undefined {
    const j = this.jobs.find((x) => x.id === id);
    return j ? { ...j } : undefined;
  }

  /** Adiciona a pasta à fila; a mesma pasta não entra duas vezes. */
  adicionar(pasta: string): Job {
    const normalizada = normalizarPasta(pasta);
    const existente = this.jobs.find((j) => normalizarPasta(j.pasta) === normalizada);
    if (existente) return { ...existente };
    const agora = new Date().toISOString();
    const job: Job = {
      id: randomUUID(),
      pasta: resolve(pasta),
      nome: basename(resolve(pasta)),
      estado: 'na-fila',
      etapa: null,
      etapasConcluidas: [],
      etapasPendentes: [],
      mensagens: [],
      criadoEm: agora,
      atualizadoEm: agora,
    };
    this.jobs.push(job);
    this.salvar();
    return { ...job };
  }

  remover(id: string): void {
    this.jobs = this.jobs.filter((j) => j.id !== id);
    this.salvar();
  }

  atualizar(id: string, mudancas: Partial<Omit<Job, 'id' | 'pasta' | 'criadoEm'>>): Job {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`Job ${id} não existe`);
    Object.assign(job, mudancas, { atualizadoEm: new Date().toISOString() });
    this.salvar();
    return { ...job };
  }

  mensagem(id: string, texto: string, nivel: NivelMensagem = 'info'): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    job.mensagens.push({ quando: new Date().toISOString(), nivel, texto });
    if (job.mensagens.length > 500) job.mensagens.splice(0, job.mensagens.length - 500);
    job.atualizadoEm = new Date().toISOString();
    this.salvar();
  }
}

function normalizarPasta(p: string): string {
  return resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}
