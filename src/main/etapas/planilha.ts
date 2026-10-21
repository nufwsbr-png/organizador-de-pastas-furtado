import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Etapa } from '../job';
import type { FontePlanilha } from '../ferramentas/planilha';
import { lerCliente, MENSAGEM_SEM_PLANILHA } from './cliente';
import { inventariar } from './inventario';

/** O que precisa estar na pasta, no lugar, para ela contar como pronta. */
export const CHECKLIST: { rotulo: string; tipos: string[] }[] = [
  { rotulo: 'Procuração', tipos: ['Procuração'] },
  { rotulo: 'Declaração', tipos: ['Declaração'] },
  { rotulo: 'RG ou CNH', tipos: ['RG', 'CNH'] },
  { rotulo: 'CTPS', tipos: ['CTPS'] },
  { rotulo: 'Contrato Trabalhista', tipos: ['Contrato Trabalhista'] },
  { rotulo: 'Entrevista preenchida', tipos: ['Entrevista preenchida'] },
];

const NOME_ETAPA: Record<string, string> = {
  zapsign: 'ZapSign',
  cliente: 'confirmação do cliente',
  whatsapp: 'WhatsApp',
  transcricao: 'transcrição',
  perguntas: 'perguntas da entrevista',
  respostas: 'respostas da entrevista',
  'pdf-entrevista': 'PDF da entrevista',
  classificar: 'identificação dos documentos',
  mover: 'arrumação das pastas',
  'entregar-entrevista': 'entrevista na pasta',
};

export function faltandoNaPasta(pasta: string): string[] {
  const noLugar = new Set(inventariar(pasta).arquivos.flatMap((a) => (a.situacao === 'no-lugar' ? [a.tipo] : [])));
  return CHECKLIST.filter((c) => !c.tipos.some((t) => noLugar.has(t))).map((c) => c.rotulo);
}

function hojeDDMM(): string {
  return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
}

/**
 * Pasta completa → planilha: Pasta pronta = Sim, marcador verde e "DD/MM Robô: pasta organizada pelo app" em Observações.
 * Só com tudo resolvido e o checklist completo; "Não" na planilha é decisão da equipe e não é trocado.
 */
export function etapaPlanilha(fonte: () => FontePlanilha | null): Etapa {
  return {
    nome: 'planilha',
    saida: 'planilha.json',
    dependeDe: ['cliente', 'mover'],
    async executar(ctx) {
      const pendentes = ctx.job.etapasPendentes.filter((e) => e !== 'planilha');
      if (pendentes.length > 0) {
        return { status: 'pendente', motivo: `A planilha só é marcada com a pasta completa. Falta resolver: ${pendentes.map((e) => NOME_ETAPA[e] ?? e).join(', ')}.` };
      }
      const faltam = faltandoNaPasta(ctx.job.pasta);
      if (faltam.length > 0) return { status: 'pendente', motivo: `Falta na pasta: ${faltam.join(', ')}. Não marquei a planilha.` };
      const p = fonte();
      if (!p) return { status: 'pendente', motivo: MENSAGEM_SEM_PLANILHA };
      const cliente = lerCliente(ctx.pastaJob);
      if (!cliente) return { status: 'pendente', motivo: 'O cliente ainda não foi confirmado na planilha.' };

      try {
        const r = await p.marcarPastaPronta({ nome: cliente.nome, telefone: cliente.telefone }, `${hojeDDMM()} Robô: pasta organizada pelo app`);
        if (r.status === 'nao') {
          return { status: 'pendente', motivo: `Na planilha, a Pasta pronta de ${cliente.nome} (linha ${r.linha}) está como "Não", uma decisão da equipe. Não mudei.` };
        }
        ctx.log(
          r.status === 'marcado'
            ? `Planilha: linha ${r.linha} marcada como Pasta pronta = Sim, com o marcador verde e a anotação em Observações.`
            : `Planilha: a linha ${r.linha} já estava como Pasta pronta = Sim.`,
        );
        writeFileSync(join(ctx.pastaJob, 'planilha.json'), JSON.stringify({ ...r, cliente, quando: new Date().toISOString() }, null, 2));
        return { status: 'ok' };
      } catch (erro) {
        return { status: 'pendente', motivo: `Planilha: ${erro instanceof Error ? erro.message : String(erro)}` };
      }
    },
  };
}
