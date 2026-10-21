// Gera "Mapa do fluxo.pdf" a partir de mapa-do-fluxo.html com o Chrome (ou o Edge) do PC, sem abrir janela.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const navegador = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!navegador) throw new Error('Não achei o Chrome nem o Edge.');

const saida = join(aqui, 'Mapa do fluxo.pdf');
execFileSync(navegador, [
  '--headless=new',
  '--disable-gpu',
  '--allow-file-access-from-files', // as fontes embutidas vêm de arquivos locais
  '--no-pdf-header-footer',
  `--print-to-pdf=${saida}`,
  pathToFileURL(join(aqui, 'mapa-do-fluxo.html')).href,
], { stdio: 'inherit' });
console.log('gerado:', saida);
