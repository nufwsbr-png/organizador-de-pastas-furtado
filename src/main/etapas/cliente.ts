import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Contexto, Etapa } from '../job';
import type { FontePlanilha, LinhaPlanilha } from '../ferramentas/planilha';
import type { FonteZapsign } from '../ferramentas/zapsign';
import { formatarTelefone, grauNome, mesmoTelefone, telefoneNacional } from '../ferramentas/nomes';
import type { DadosCliente } from './perguntas';

/** Quem é o cliente da pasta: a linha dele na planilha, com o telefone conferido. */
export interface ClienteConfirmado {
  /** Como está na planilha. */
  nome: string;
  /** DDD + número, só dígitos. */
  telefone: string;
  linha: number;
  confirmadoPor: 'zapsign' | 'entrevista' | 'informado' | 'unico-na-planilha';
}

export const MENSAGEM_SEM_PLANILHA =
  'Para achar o telefone do cliente e marcar a planilha preciso da planilha configurada em Ajustes → Planilha. Depois clique em Tentar de novo.';

function dadosDaEntrevista(pastaJob: string): DadosCliente {
  try {
    return JSON.parse(readFileSync(join(pastaJob, 'dados-cliente.json'), 'utf8')) as DadosCliente;
  } catch {
    return {}; // entrevista ainda sem dados do cliente
  }
}

/** Nome do cliente: o informado na tela, o do documento da entrevista ou o da pasta ("arquivos-Fulano-de-Tal" vira "Fulano de Tal"). */
export function nomeDoCliente(ctx: Contexto): string {
  const informado = ctx.job.cliente?.nome?.trim();
  if (informado) return informado;
  const daEntrevista = dadosDaEntrevista(ctx.pastaJob).nome?.trim();
  if (daEntrevista) return daEntrevista;
  return ctx.job.nome.replace(/^arquivos[-_ ]+/i, '').replace(/[-_]+/g, ' ').trim() || ctx.job.nome;
}

export function lerCliente(pastaJob: string): ClienteConfirmado | null {
  try {
    return JSON.parse(readFileSync(join(pastaJob, 'cliente.json'), 'utf8')) as ClienteConfirmado;
  } catch {
    return null;
  }
}

/** Telefones dos signatários do ZapSign com o mesmo nome (o cliente digitou o número ao assinar). */
async function telefonesNoZapsign(z: FonteZapsign | null, nome: string): Promise<string[]> {
  if (!z) return [];
  try {
    const { envelopes } = await z.buscarPorNome(nome);
    const sigs = envelopes.flatMap((e) => e.signatarios).filter((s) => s.telefone && grauNome(nome, s.nome));
    const iguais = sigs.filter((s) => grauNome(nome, s.nome) === 'igual');
    return [...new Set((iguais.length > 0 ? iguais : sigs).map((s) => s.telefone!))];
  } catch {
    return [];
  }
}

const descrever = (ls: LinhaPlanilha[]) => ls.map((l) => `${l.nome}, ${formatarTelefone(l.telefone)} (linha ${l.linha})`).join('; ');

type Escolha = { linha: LinhaPlanilha; por: ClienteConfirmado['confirmadoPor'] } | { pendente: string };

/** Escolhe a linha da planilha conferindo nome e número (o informado na tela, o do ZapSign ou o do documento da entrevista). */
export function escolherLinha(
  nome: string,
  linhas: (LinhaPlanilha & { grau: 'igual' | 'parecido' })[],
  telefoneInformado: string | null,
  telefonesZapsign: string[],
  telefoneEntrevista: string | null = null,
): Escolha {
  const informar = 'Informe abaixo o nome e o telefone do cliente e clique em Buscar de novo.';
  if (telefoneInformado) {
    const c = linhas.filter((l) => mesmoTelefone(l.telefone, telefoneInformado));
    if (c.length === 1) return { linha: c[0], por: 'informado' };
    if (c.length > 1) return { pendente: `"${nome}" com o telefone ${formatarTelefone(telefoneInformado)} aparece em mais de uma linha da planilha: ${descrever(c)}. Deixe só uma.` };
    return { pendente: `Não achei na planilha "${nome}" com o telefone ${formatarTelefone(telefoneInformado)}. Confira a planilha. ${informar}` };
  }
  if (linhas.length === 0) return { pendente: `Não achei "${nome}" na planilha. Se lá o nome estiver diferente, informe abaixo o nome e o telefone do cliente e clique em Buscar de novo.` };

  const iguais = linhas.filter((l) => l.grau === 'igual');
  const base = iguais.length > 0 ? iguais : linhas;
  if (telefonesZapsign.length > 0) {
    const c = base.filter((l) => telefonesZapsign.some((t) => mesmoTelefone(t, l.telefone)));
    if (c.length === 1) return { linha: c[0], por: 'zapsign' };
    if (c.length > 1) return { pendente: `"${nome}" aparece em mais de uma linha da planilha com o mesmo telefone do ZapSign: ${descrever(c)}. Deixe só uma.` };
  }
  if (telefoneEntrevista) {
    const c = base.filter((l) => mesmoTelefone(telefoneEntrevista, l.telefone));
    if (c.length === 1) return { linha: c[0], por: 'entrevista' };
    if (c.length > 1) return { pendente: `"${nome}" aparece em mais de uma linha da planilha com o telefone do documento da entrevista: ${descrever(c)}. Deixe só uma.` };
  }
  if (telefonesZapsign.length > 0 || telefoneEntrevista) {
    const zap = telefonesZapsign.length > 0 ? telefonesZapsign.map(formatarTelefone).join(' ou ') : null;
    const ent = telefoneEntrevista ? formatarTelefone(telefoneEntrevista) : null;
    if (base.length === 1) {
      const de = [zap && `do que o cliente usou no ZapSign (${zap})`, ent && `do que está no documento da entrevista (${ent})`].filter(Boolean).join(' e ');
      return { pendente: `O telefone da planilha (${formatarTelefone(base[0].telefone)}, linha ${base[0].linha}) é diferente ${de}. ${informar}` };
    }
    const tels = [zap && `o telefone do ZapSign (${zap})`, ent && `o do documento da entrevista (${ent})`].filter(Boolean).join(' nem ');
    return { pendente: `Há ${base.length} linhas parecidas com "${nome}" na planilha e nenhuma tem ${tels}: ${descrever(base)}. ${informar}` };
  }
  if (base.length === 1) return { linha: base[0], por: 'unico-na-planilha' };
  return { pendente: `Há ${base.length} linhas parecidas com "${nome}" na planilha: ${descrever(base)}. ${informar}` };
}

/**
 * Confirma quem é o cliente: nome do documento da entrevista → linha da planilha → telefone,
 * conferido com o telefone que o cliente usou no ZapSign. O telefone confirmado é o usado no WhatsApp e na marcação da planilha.
 */
export function etapaCliente(fontes: { planilha: () => FontePlanilha | null; zapsign: () => FonteZapsign | null }): Etapa {
  return {
    nome: 'cliente',
    saida: 'cliente.json',
    async executar(ctx) {
      const nome = nomeDoCliente(ctx);
      const p = fontes.planilha();
      if (!p) return { status: 'pendente', motivo: MENSAGEM_SEM_PLANILHA };
      const digitado = ctx.job.cliente?.telefone?.trim();
      const informado = telefoneNacional(digitado);
      if (digitado && !informado) return { status: 'pendente', motivo: `O telefone informado (${digitado}) não parece um número com DDD. Informe de novo abaixo.` };

      try {
        const linhas = await p.procurarPorNome(nome);
        const zap = informado ? [] : await telefonesNoZapsign(fontes.zapsign(), nome);
        const escolha = escolherLinha(nome, linhas, informado, zap, telefoneNacional(dadosDaEntrevista(ctx.pastaJob).telefone));
        if ('pendente' in escolha) return { status: 'pendente', motivo: escolha.pendente };
        const telefone = telefoneNacional(escolha.linha.telefone);
        if (!telefone) return { status: 'pendente', motivo: `A linha ${escolha.linha.linha} da planilha não tem um telefone válido ("${escolha.linha.telefone}"). Corrija a planilha e clique em Tentar de novo.` };

        const cliente: ClienteConfirmado = { nome: escolha.linha.nome, telefone, linha: escolha.linha.linha, confirmadoPor: escolha.por };
        writeFileSync(join(ctx.pastaJob, 'cliente.json'), JSON.stringify(cliente, null, 2));
        const como = {
          zapsign: 'mesmo telefone do ZapSign',
          entrevista: 'mesmo telefone do documento da entrevista',
          informado: 'telefone informado na tela',
          'unico-na-planilha': 'única linha com esse nome',
        }[escolha.por];
        ctx.log(`Cliente confirmado: ${cliente.nome}, ${formatarTelefone(telefone)}, linha ${cliente.linha} da planilha (${como}).`);
        return { status: 'ok' };
      } catch (erro) {
        return { status: 'pendente', motivo: `Planilha: ${erro instanceof Error ? erro.message : String(erro)}` };
      }
    },
  };
}
