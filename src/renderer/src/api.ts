import type { Api } from '../../preload/index';
import type { Ajustes } from '../../main/config';
import type { Job } from '../../main/fila';
import type { EstadoAtualizacao } from '../../main/atualizador';
import type { IdProvedor, StatusProvedor } from '../../main/provedores/tipos';

export type { Ajustes, Job, EstadoAtualizacao, IdProvedor, StatusProvedor };

export interface EstadoApp {
  ajustes: Ajustes;
  jobs: Job[];
  versao: string;
  chaveElevenLabs: string | null;
  tokenZapsign: string | null;
  atualizacao: EstadoAtualizacao;
  arquivoEnv: string;
}

type StatusProvedores = Record<IdProvedor, StatusProvedor>;

/** Mesma forma do preload, com os tipos do processo principal. */
export interface ApiTipada {
  estado: () => Promise<EstadoApp>;
  provedores: {
    status: () => Promise<StatusProvedores>;
    escolher: (id: IdProvedor | null) => Promise<Ajustes>;
    login: (id: IdProvedor) => Promise<StatusProvedores>;
    instalar: (id: IdProvedor) => Promise<StatusProvedores>;
  };
  pastas: { escolher: () => Promise<Job[]> };
  jobs: {
    organizar: (id?: string) => Promise<Job[]>;
    remover: (id: string) => Promise<Job[]>;
    refazer: (id: string) => Promise<Job[]>;
    buscaZapsign: (id: string, busca: string) => Promise<Job[]>;
    limparConcluidas: () => Promise<Job[]>;
    abrirPasta: (caminho: string) => Promise<string>;
    onMudar: (cb: (jobs: Job[]) => void) => () => void;
  };
  ajustes: {
    definir: (mudancas: Partial<Ajustes>) => Promise<Ajustes>;
    chave: (chave: string) => Promise<string | null>;
    testarChave: () => Promise<{ ok: boolean; mensagem: string }>;
    tokenZapsign: (token: string) => Promise<string | null>;
    testarZapsign: () => Promise<{ ok: boolean; mensagem: string }>;
    abrirLogs: () => Promise<string>;
  };
  atualizacao: {
    buscar: () => Promise<EstadoAtualizacao | undefined>;
    baixar: () => Promise<void>;
    instalar: () => Promise<void>;
    onMudar: (cb: (estado: EstadoAtualizacao) => void) => () => void;
  };
  onAviso: (cb: (texto: string) => void) => () => void;
}

declare global {
  interface Window {
    api: Api;
  }
}

export const api = window.api as unknown as ApiTipada;
