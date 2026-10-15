import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

function criarJanela(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'Organizador de Pastas Furtado',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false },
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

void app.whenReady().then(criarJanela);
app.on('window-all-closed', () => app.quit());
