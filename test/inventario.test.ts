import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventariar } from '../src/main/etapas/inventario';

function pastaCliente(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cliente-'));
  mkdirSync(join(dir, 'Contratos'));
  mkdirSync(join(dir, 'Documentos'));
  mkdirSync(join(dir, 'Fotos', 'sub'), { recursive: true });
  writeFileSync(join(dir, 'Contratos', 'Procuração.pdf'), 'pdf');
  writeFileSync(join(dir, 'Documentos', 'foto.pdf'), 'pdf');
  writeFileSync(join(dir, 'Fotos', 'sub', 'WhatsApp Image.jpeg'), 'jpg');
  writeFileSync(join(dir, 'Áudio da ligação.wav'), 'wav');
  writeFileSync(join(dir, 'Perguntas entrevista .pdf'), 'pdf');
  writeFileSync(join(dir, 'Thumbs.db'), '');
  return dir;
}

describe('inventariar', () => {
  it('lista todos os arquivos com caminho relativo, tamanho e situação', () => {
    const dir = pastaCliente();
    const inv = inventariar(dir);
    const porCaminho = Object.fromEntries(inv.arquivos.map((a) => [a.relativo, a]));
    expect(porCaminho['Contratos/Procuração.pdf']).toMatchObject({ situacao: 'no-lugar', tipo: 'Procuração', tamanho: 3 });
    expect(porCaminho['Documentos/foto.pdf']).toMatchObject({ situacao: 'classificar' });
    expect(porCaminho['Fotos/sub/WhatsApp Image.jpeg']).toMatchObject({ situacao: 'classificar' });
    expect(porCaminho['Áudio da ligação.wav']).toMatchObject({ situacao: 'mover', tipo: 'Áudio da ligação' });
    expect(porCaminho['Perguntas entrevista .pdf']).toMatchObject({ situacao: 'mover', tipo: 'Perguntas entrevista' });
    expect(porCaminho['Thumbs.db']).toMatchObject({ situacao: 'ignorar' });
  });

  it('separa os áudios e o PDF de perguntas para as etapas seguintes', () => {
    const inv = inventariar(pastaCliente());
    expect(inv.audios).toEqual(['Áudio da ligação.wav']);
    expect(inv.perguntas).toBe('Perguntas entrevista .pdf');
  });

  it('sem áudio nem perguntas devolve vazio/null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cliente-'));
    writeFileSync(join(dir, 'RG.pdf'), 'x');
    const inv = inventariar(dir);
    expect(inv.audios).toEqual([]);
    expect(inv.perguntas).toBeNull();
  });

  it('grava o inventário em JSON quando recebe o destino', () => {
    const dir = pastaCliente();
    const destino = join(mkdtempSync(join(tmpdir(), 'job-')), 'inventario.json');
    inventariar(dir, destino);
    const lido = JSON.parse(readFileSync(destino, 'utf8'));
    expect(lido.arquivos.length).toBe(6);
  });
});
