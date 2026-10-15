import { app } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

export type EstadoAtualizacao =
  | { estado: 'dev' }
  | { estado: 'verificando' }
  | { estado: 'atualizado'; versao: string }
  | { estado: 'disponivel'; versao: string }
  | { estado: 'baixando'; porcento: number }
  | { estado: 'pronta'; versao: string }
  | { estado: 'erro'; mensagem: string };

/** Fala com as releases do GitHub via electron-updater e repassa o estado para a tela. */
export class Atualizador {
  private ultimo: EstadoAtualizacao = app.isPackaged ? { estado: 'atualizado', versao: app.getVersion() } : { estado: 'dev' };

  constructor(
    private emitir: (estado: EstadoAtualizacao) => void,
    private log: (texto: string) => void = () => {},
  ) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this.mudar({ estado: 'verificando' }));
    autoUpdater.on('update-available', (info) => this.mudar({ estado: 'disponivel', versao: info.version }));
    autoUpdater.on('update-not-available', () => this.mudar({ estado: 'atualizado', versao: app.getVersion() }));
    autoUpdater.on('download-progress', (p) => this.mudar({ estado: 'baixando', porcento: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (info) => this.mudar({ estado: 'pronta', versao: info.version }));
    autoUpdater.on('error', (erro) => this.mudar({ estado: 'erro', mensagem: erro?.message ?? String(erro) }));
  }

  private mudar(estado: EstadoAtualizacao): void {
    this.ultimo = estado;
    this.log(`atualizador: ${JSON.stringify(estado)}`);
    this.emitir(estado);
  }

  estado(): EstadoAtualizacao {
    return this.ultimo;
  }

  async buscar(): Promise<EstadoAtualizacao> {
    if (!app.isPackaged) {
      this.mudar({ estado: 'dev' });
      return this.ultimo;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (erro) {
      this.mudar({ estado: 'erro', mensagem: erro instanceof Error ? erro.message : String(erro) });
    }
    return this.ultimo;
  }

  async baixar(): Promise<void> {
    if (!app.isPackaged) return;
    try {
      await autoUpdater.downloadUpdate();
    } catch (erro) {
      this.mudar({ estado: 'erro', mensagem: erro instanceof Error ? erro.message : String(erro) });
    }
  }

  instalar(): void {
    if (!app.isPackaged) return;
    autoUpdater.quitAndInstall(false, true);
  }
}
