import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

function ouvir<T>(canal: string, cb: (dados: T) => void): () => void {
  const h = (_e: IpcRendererEvent, dados: T) => cb(dados);
  ipcRenderer.on(canal, h);
  return () => {
    ipcRenderer.off(canal, h);
  };
}

const api = {
  estado: () => ipcRenderer.invoke('estado'),
  provedores: {
    status: () => ipcRenderer.invoke('provedores:status'),
    escolher: (id: string | null) => ipcRenderer.invoke('provedores:escolher', id),
    login: (id: string) => ipcRenderer.invoke('provedores:login', id),
    instalar: (id: string) => ipcRenderer.invoke('provedores:instalar', id),
  },
  pastas: { escolher: () => ipcRenderer.invoke('pastas:escolher') },
  jobs: {
    organizar: (id?: string) => ipcRenderer.invoke('jobs:organizar', id),
    remover: (id: string) => ipcRenderer.invoke('jobs:remover', id),
    refazer: (id: string) => ipcRenderer.invoke('jobs:refazer', id),
    abrirPasta: (caminho: string) => ipcRenderer.invoke('jobs:abrirPasta', caminho),
    onMudar: (cb: (jobs: unknown) => void) => ouvir('jobs', cb),
  },
  ajustes: {
    definir: (mudancas: Record<string, unknown>) => ipcRenderer.invoke('ajustes:definir', mudancas),
    chave: (chave: string) => ipcRenderer.invoke('ajustes:chave', chave),
    testarChave: () => ipcRenderer.invoke('ajustes:testarChave'),
    abrirLogs: () => ipcRenderer.invoke('ajustes:abrirLogs'),
  },
  atualizacao: {
    buscar: () => ipcRenderer.invoke('atualizacao:buscar'),
    baixar: () => ipcRenderer.invoke('atualizacao:baixar'),
    instalar: () => ipcRenderer.invoke('atualizacao:instalar'),
    onMudar: (cb: (estado: unknown) => void) => ouvir('atualizacao', cb),
  },
  onAviso: (cb: (texto: string) => void) => ouvir('aviso', cb),
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
