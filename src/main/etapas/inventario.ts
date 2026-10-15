import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { classificarCaminho, type Situacao } from '../padrao';

export type ArquivoInventariado = {
  relativo: string;
  tamanho: number;
  modificadoEm: string;
} & Situacao;

export interface Inventario {
  pasta: string;
  feitoEm: string;
  arquivos: ArquivoInventariado[];
  /** Caminhos relativos dos áudios da ligação. */
  audios: string[];
  /** Caminho relativo do PDF de perguntas, se houver. */
  perguntas: string | null;
}

/** Lista todos os arquivos da pasta do cliente e diz o que fazer com cada um. */
export function inventariar(pastaCliente: string, destinoJson?: string): Inventario {
  const arquivos: ArquivoInventariado[] = [];
  const percorrer = (dir: string) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, entrada.name);
      if (entrada.isDirectory()) {
        percorrer(caminho);
        continue;
      }
      if (!entrada.isFile()) continue;
      const st = statSync(caminho);
      const relativo = relative(pastaCliente, caminho).split('\\').join('/');
      arquivos.push({ relativo, tamanho: st.size, modificadoEm: st.mtime.toISOString(), ...classificarCaminho(relativo) });
    }
  };
  percorrer(pastaCliente);
  arquivos.sort((a, b) => a.relativo.localeCompare(b.relativo, 'pt-BR'));

  const audios = arquivos.filter((a) => a.situacao !== 'ignorar' && 'tipo' in a && a.tipo === 'Áudio da ligação').map((a) => a.relativo);
  const perguntas = arquivos.find((a) => 'tipo' in a && a.tipo === 'Perguntas entrevista')?.relativo ?? null;

  const inventario: Inventario = { pasta: pastaCliente, feitoEm: new Date().toISOString(), arquivos, audios, perguntas };
  if (destinoJson) {
    mkdirSync(dirname(destinoJson), { recursive: true });
    writeFileSync(destinoJson, JSON.stringify(inventario, null, 2));
  }
  return inventario;
}
