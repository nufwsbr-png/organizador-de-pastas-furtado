import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Etapa } from '../job';
import { nomeFinal } from '../padrao';

/** Copia o PDF da entrevista preenchida para a pasta Entrevista do cliente (roda depois de tudo, inclusive em retomadas). */
export function etapaEntregarEntrevista(): Etapa {
  return {
    nome: 'entregar-entrevista',
    saida: 'entrevista-entregue.json',
    dependeDe: ['pdf-entrevista', 'mover'],
    async executar(ctx) {
      const origem = join(ctx.pastaJob, 'Entrevista preenchida.pdf');
      const destino = join(ctx.job.pasta, nomeFinal('Entrevista preenchida', '.pdf'));
      mkdirSync(dirname(destino), { recursive: true });
      if (existsSync(destino) && !readFileSync(destino).equals(readFileSync(origem))) {
        const guardado = join(ctx.job.pasta, '_substituidos', 'Entrevista', `Entrevista preenchida (${Date.now()}).pdf`);
        mkdirSync(dirname(guardado), { recursive: true });
        renameSync(destino, guardado);
      }
      copyFileSync(origem, destino);
      writeFileSync(join(ctx.pastaJob, 'entrevista-entregue.json'), JSON.stringify({ destino, quando: new Date().toISOString() }));
      ctx.log('Entrevista preenchida.pdf salvo na pasta Entrevista.');
      return { status: 'ok' };
    },
  };
}
