import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { IdProvedor } from './tipos';

/** Abre uma janela de terminal com o comando e resolve quando ela fechar. */
export function abrirTerminal(titulo: string, comando: string): Promise<void> {
  return new Promise((resolve) => {
    const filho = spawn('cmd.exe', ['/d', '/c', `start "${titulo}" /wait cmd /c "${comando} & echo. & echo Pode fechar esta janela. & pause"`], {
      windowsVerbatimArguments: true,
      detached: false,
      stdio: 'ignore',
    });
    filho.on('close', () => resolve());
    filho.on('error', () => resolve());
  });
}

/** Faz o login oficial do CLI (abre o navegador) numa janela de terminal. */
export function loginProvedor(id: IdProvedor, executavel: string): Promise<void> {
  const exe = `"${executavel}"`;
  return id === 'claude' ? abrirTerminal('Entrar com Claude', `${exe} auth login`) : abrirTerminal('Entrar com ChatGPT', `${exe} login`);
}

/** Instala o Claude Code pelo instalador oficial (não precisa de Node). */
export function instalarClaude(): Promise<void> {
  return abrirTerminal('Instalar Claude Code', 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"');
}

const URL_CODEX = 'https://github.com/openai/codex/releases/latest/download/codex-x86_64-pc-windows-msvc.exe.zip';

/** Baixa o binário oficial do Codex para a pasta do app e devolve o caminho do codex.exe. */
export async function instalarCodex(pastaBin: string, aoProgredir?: (texto: string) => void): Promise<string> {
  mkdirSync(pastaBin, { recursive: true });
  const zip = join(pastaBin, 'codex.zip');
  aoProgredir?.('Baixando o Codex…');
  const resposta = await fetch(URL_CODEX);
  if (!resposta.ok || !resposta.body) throw new Error(`Não consegui baixar o Codex (${resposta.status}).`);
  await pipeline(Readable.fromWeb(resposta.body as import('node:stream/web').ReadableStream), createWriteStream(zip));
  aoProgredir?.('Descompactando…');
  await new Promise<void>((resolve, reject) => {
    const p = spawn('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${pastaBin}' -Force`], { windowsHide: true });
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`Falha ao descompactar o Codex (código ${c}).`))));
    p.on('error', reject);
  });
  const final = join(pastaBin, 'codex.exe');
  const baixado = join(pastaBin, 'codex-x86_64-pc-windows-msvc.exe');
  if (!existsSync(final) && existsSync(baixado)) renameSync(baixado, final);
  if (!existsSync(final)) throw new Error('O download do Codex terminou, mas não achei o codex.exe.');
  return final;
}
