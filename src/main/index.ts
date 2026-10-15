import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Atualizador, type EstadoAtualizacao } from './atualizador';
import { Config, type Ajustes } from './config';
import { etapaClassificar } from './etapas/classificar';
import { etapaEntregarEntrevista } from './etapas/entregar-entrevista';
import { inventariar } from './etapas/inventario';
import { etapaMover } from './etapas/mover';
import { etapaPdfEntrevista } from './etapas/pdf-entrevista';
import { etapaPerguntas } from './etapas/perguntas';
import { etapaRespostas } from './etapas/respostas';
import { etapaTranscricao } from './etapas/transcricao';
import { transcreverElevenLabs } from './ferramentas/elevenlabs';
import type { Job } from './fila';
import { ErroPausa, type Etapa } from './job';
import { Orquestrador } from './orquestrador';
import { ProvedorClaude } from './provedores/claude';
import { ProvedorCodex } from './provedores/codex';
import { instalarClaude, instalarCodex, loginProvedor } from './provedores/instalar';
import { candidatosPadrao, localizarExecutavel } from './provedores/localizar';
import { matarProcessos } from './provedores/processo';
import type { IdProvedor, Provedor, StatusProvedor } from './provedores/tipos';

if (process.env.ORGANIZADOR_DADOS) app.setPath('userData', process.env.ORGANIZADOR_DADOS);
const userData = app.getPath('userData');
mkdirSync(userData, { recursive: true });
const arquivoLog = join(userData, 'log.txt');

function log(texto: string): void {
  try {
    appendFileSync(arquivoLog, `${new Date().toISOString()} ${texto}\n`);
  } catch {
    /* sem log não para o app */
  }
}

const config = new Config(userData, [join(app.getAppPath(), '.env'), join(process.cwd(), '.env')]);
const pastaBin = join(userData, 'bin');
const TIMEOUT_IA = 25 * 60_000;

function executavel(id: IdProvedor): string | null {
  return localizarExecutavel(id, { candidatos: candidatosPadrao(id, [join(pastaBin, 'codex.exe')]) });
}

function provedor(id: IdProvedor): Provedor | null {
  const exe = executavel(id);
  if (!exe) return null;
  return id === 'claude'
    ? new ProvedorClaude({ executavel: exe, timeoutMs: TIMEOUT_IA })
    : new ProvedorCodex({ executavel: exe, timeoutMs: TIMEOUT_IA, pastaTemp: join(userData, 'tmp') });
}

function provedorAtual(): Provedor {
  const id = config.obter().provedor;
  if (!id) throw new ErroPausa('Escolha Claude ou ChatGPT na tela inicial antes de organizar.');
  const p = provedor(id);
  if (!p) throw new ErroPausa(`O programa do ${id === 'claude' ? 'Claude' : 'ChatGPT (Codex)'} não está instalado neste computador. Vá à tela inicial e instale.`);
  return p;
}

function etapaInventario(): Etapa {
  return {
    nome: 'inventario',
    saida: 'inventario.json',
    async executar(ctx) {
      const inv = inventariar(ctx.job.pasta, join(ctx.pastaJob, 'inventario.json'));
      const uteis = inv.arquivos.filter((a) => a.situacao !== 'ignorar');
      ctx.log(`${uteis.length} arquivo(s) na pasta; ${inv.audios.length} áudio(s); perguntas: ${inv.perguntas ?? 'não achei'}.`);
      return { status: 'ok' };
    },
  };
}

function montarEtapas(): Etapa[] {
  return [
    etapaInventario(),
    etapaTranscricao({ chave: () => config.chaveElevenLabs(), transcrever: (arquivo, chave) => transcreverElevenLabs(arquivo, chave) }),
    etapaPerguntas(provedorAtual),
    etapaRespostas(provedorAtual),
    etapaPdfEntrevista(),
    etapaClassificar(provedorAtual),
    etapaMover(),
    etapaEntregarEntrevista(),
  ];
}

const orquestrador = new Orquestrador({
  userData,
  paralelismo: () => config.obter().paralelismo,
  etapas: montarEtapas,
  // relê a pasta a cada execução (o usuário pode ter colocado a transcrição ou as perguntas)
  antesDeRodar: (pastaJob) => rmSync(join(pastaJob, 'inventario.json'), { force: true }),
});

let janela: BrowserWindow | null = null;
let atualizador: Atualizador | null = null;

function enviar(canal: string, dados: unknown): void {
  if (janela && !janela.isDestroyed()) janela.webContents.send(canal, dados);
}

orquestrador.fila.aoMudar((jobs) => enviar('jobs', jobs));

/** `--captura=<arquivo.png>`: renderiza a janela escondida, salva a imagem e fecha (usado só para conferir o visual). */
const arquivoCaptura = process.argv.find((a) => a.startsWith('--captura='))?.slice('--captura='.length) ?? null;

function criarJanela(): void {
  janela = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: !arquivoCaptura,
    title: 'Organizador de Pastas Furtado',
    autoHideMenuBar: true,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.mjs'), sandbox: false, contextIsolation: true },
  });
  if (process.env.ELECTRON_RENDERER_URL) void janela.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void janela.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  janela.on('closed', () => (janela = null));
  if (arquivoCaptura) {
    janela.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const imagem = await janela!.webContents.capturePage();
          writeFileSync(arquivoCaptura, imagem.toPNG());
        } finally {
          app.quit();
        }
      }, 2500);
    });
  }
}

async function statusProvedores(): Promise<Record<IdProvedor, StatusProvedor>> {
  const resultado = {} as Record<IdProvedor, StatusProvedor>;
  for (const id of ['claude', 'codex'] as const) {
    const p = provedor(id);
    resultado[id] = p ? await p.status() : { instalado: false, logado: false, conta: null, caminho: null };
  }
  return resultado;
}

function mascarar(chave: string | null): string | null {
  if (!chave) return null;
  return chave.length <= 8 ? '••••' : `${chave.slice(0, 4)}…${chave.slice(-4)}`;
}

function estado() {
  return {
    ajustes: config.obter(),
    jobs: orquestrador.jobs(),
    versao: app.getVersion(),
    chaveElevenLabs: mascarar(config.chaveElevenLabs()),
    atualizacao: atualizador?.estado() ?? ({ estado: 'dev' } as EstadoAtualizacao),
    arquivoEnv: config.caminhoEnv(),
  };
}

function registrarIpc(): void {
  ipcMain.handle('estado', () => estado());
  ipcMain.handle('provedores:status', () => statusProvedores());
  ipcMain.handle('provedores:escolher', (_e, id: IdProvedor | null) => config.definir({ provedor: id }));
  ipcMain.handle('provedores:login', async (_e, id: IdProvedor) => {
    const exe = executavel(id);
    if (exe) await loginProvedor(id, exe);
    return statusProvedores();
  });
  ipcMain.handle('provedores:instalar', async (_e, id: IdProvedor) => {
    if (id === 'claude') await instalarClaude();
    else await instalarCodex(pastaBin, (t) => enviar('aviso', t));
    return statusProvedores();
  });

  ipcMain.handle('pastas:escolher', async () => {
    const r = await dialog.showOpenDialog(janela!, {
      title: 'Escolha a(s) pasta(s) do(s) cliente(s)',
      properties: ['openDirectory', 'multiSelections'],
      buttonLabel: 'Enviar pasta',
    });
    if (r.canceled) return orquestrador.jobs();
    for (const p of r.filePaths) orquestrador.adicionarPasta(p);
    return orquestrador.jobs();
  });
  ipcMain.handle('jobs:organizar', (_e, id?: string) => {
    const promessa = id ? orquestrador.organizar(id) : orquestrador.organizarTudo();
    promessa.catch((erro) => log(`organizar falhou: ${erro}`));
    return orquestrador.jobs();
  });
  ipcMain.handle('jobs:remover', (_e, id: string) => {
    orquestrador.remover(id);
    return orquestrador.jobs();
  });
  ipcMain.handle('jobs:refazer', (_e, id: string) => {
    orquestrador.refazer(id);
    return orquestrador.jobs();
  });
  ipcMain.handle('jobs:abrirPasta', (_e, caminho: string) => shell.openPath(caminho));

  ipcMain.handle('ajustes:definir', (_e, mudancas: Partial<Ajustes>) => config.definir(mudancas));
  ipcMain.handle('ajustes:chave', (_e, chave: string) => {
    config.definirChaveElevenLabs(chave);
    return mascarar(config.chaveElevenLabs());
  });
  ipcMain.handle('ajustes:testarChave', async () => {
    const chave = config.chaveElevenLabs();
    if (!chave) return { ok: false, mensagem: 'Nenhuma chave salva.' };
    try {
      const r = await fetch('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': chave }, signal: AbortSignal.timeout(20_000) });
      if (r.status === 401) return { ok: false, mensagem: 'Chave inválida (401).' };
      if (!r.ok) return { ok: false, mensagem: `O ElevenLabs respondeu ${r.status}.` };
      const dados = (await r.json()) as { subscription?: { tier?: string; character_count?: number } };
      return { ok: true, mensagem: `Chave válida${dados.subscription?.tier ? ` (plano ${dados.subscription.tier})` : ''}.` };
    } catch (erro) {
      return { ok: false, mensagem: `Não consegui falar com o ElevenLabs: ${erro instanceof Error ? erro.message : String(erro)}` };
    }
  });
  ipcMain.handle('ajustes:abrirLogs', () => shell.openPath(userData));

  ipcMain.handle('atualizacao:buscar', () => atualizador?.buscar());
  ipcMain.handle('atualizacao:baixar', () => atualizador?.baixar());
  ipcMain.handle('atualizacao:instalar', () => atualizador?.instalar());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (janela) {
      if (janela.isMinimized()) janela.restore();
      janela.focus();
    }
  });

  void app.whenReady().then(() => {
    log(`app ${app.getVersion()} iniciado`);
    atualizador = new Atualizador((e) => enviar('atualizacao', e), log);
    registrarIpc();
    criarJanela();
    if (!existsSync(join(userData, 'jobs'))) mkdirSync(join(userData, 'jobs'), { recursive: true });
    if (!arquivoCaptura) {
      orquestrador.retomarPendentes().catch((erro) => log(`retomar falhou: ${erro}`));
      setTimeout(() => atualizador?.buscar(), 5_000);
    }
  });

  app.on('before-quit', () => matarProcessos());
  app.on('window-all-closed', () => app.quit());
}

export type EstadoApp = ReturnType<typeof estado>;
export type { Job, StatusProvedor, IdProvedor, Ajustes, EstadoAtualizacao };
