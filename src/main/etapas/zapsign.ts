import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Etapa } from '../job';
import { nomeFinal, normalizar } from '../padrao';
import { grauNome, palavrasDoNome, type EnvelopeDetalhe, type EnvelopeIndice, type FonteZapsign } from '../ferramentas/zapsign';
import { inventariar, type Inventario } from './inventario';
import { guardarEmSubstituidos, type Feito } from './mover';

/** Documentos que chegam assinados pelo ZapSign. */
export const DOCUMENTOS_ASSINADOS = ['Procuração', 'Declaração', 'Contrato Trabalhista'] as const;
export type DocumentoAssinado = (typeof DOCUMENTOS_ASSINADOS)[number];

export const MENSAGEM_SEM_TOKEN =
  'Para puxar a procuração, a declaração e o contrato assinados preciso do token da API do ZapSign. Coloque em Ajustes e clique em Tentar de novo.';

/** Quantos envelopes do cliente (do mais novo para o mais antigo) são abertos atrás dos documentos. */
const MAX_ENVELOPES = 5;

/** Tipo do documento pelo nome que ele tem no ZapSign ("Procuração Trabalhista Furtado.docx" → Procuração). */
export function tipoDoAssinado(nome: string): DocumentoAssinado | null {
  const n = normalizar(nome);
  if (n.includes('procura')) return 'Procuração';
  if (/declara|hipossufic|pobreza|gratuidade/.test(n)) return 'Declaração';
  if (/contrato|honorario/.test(n)) return 'Contrato Trabalhista';
  return null;
}

type Busca = { tipo: 'nome' | 'email' | 'token'; valor: string };

/** O que o usuário digitou para achar o cliente: link/token do documento, e-mail ou nome. */
export function interpretarBusca(texto: string): Busca {
  const valor = texto.trim();
  const token = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(valor)?.[0];
  if (token) return { tipo: 'token', valor: token.toLowerCase() };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) return { tipo: 'email', valor };
  return { tipo: 'nome', valor };
}

function data(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Grava o PDF no lugar; se já houver outro arquivo ali, ele vai para _substituidos. */
function gravarNoLugar(pastaCliente: string, relativo: string, conteudo: Buffer, feitos: Feito[]): boolean {
  const destino = join(pastaCliente, relativo);
  if (existsSync(destino)) {
    if (readFileSync(destino).equals(conteudo)) return false;
    guardarEmSubstituidos(pastaCliente, relativo, feitos);
  }
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, conteudo);
  return true;
}

type Escolha = { envelopes: EnvelopeIndice[] } | { pendente: string };

/** Acha os envelopes do cliente: por token, e-mail ou nome (o da pasta, se o usuário não informou outro). */
async function acharEnvelopes(fonte: FonteZapsign, busca: Busca): Promise<Escolha> {
  if (busca.tipo === 'token') {
    const d = await fonte.detalhar(busca.valor);
    return { envelopes: [{ token: d.token, nome: d.nome, status: d.status, criadoEm: d.criadoEm, signatarios: d.signatarios }] };
  }
  if (busca.tipo === 'email') {
    const envelopes = await fonte.buscarPorEmail(busca.valor);
    return envelopes.length > 0 ? { envelopes } : { pendente: `Não achei no ZapSign nenhum documento com o signatário ${busca.valor}.` };
  }

  const { envelopes, desde } = await fonte.buscarPorNome(busca.valor);
  const candidatos = envelopes.flatMap((e) => e.signatarios.map((s) => ({ e, s, grau: grauNome(busca.valor, s.nome) }))).filter((c) => c.grau !== null);
  const iguais = candidatos.filter((c) => c.grau === 'igual');
  const escolhidos = iguais.length > 0 ? iguais : candidatos;
  if (escolhidos.length === 0) {
    return {
      pendente:
        `Não achei no ZapSign um documento assinado por "${busca.valor}" (procurei desde ${data(desde)}). ` +
        'Se o nome no ZapSign for diferente do nome da pasta, informe abaixo o nome, o e-mail ou o link do documento no ZapSign e clique em Buscar de novo.',
    };
  }
  const pessoas = [...new Set(escolhidos.map((c) => palavrasDoNome(c.s.nome).join(' ')))];
  if (pessoas.length > 1) {
    const nomes = [...new Set(escolhidos.map((c) => c.s.nome))].slice(0, 5).join('; ');
    return { pendente: `Achei mais de um cliente parecido com "${busca.valor}" no ZapSign: ${nomes}. Informe abaixo o nome completo, o e-mail ou o link do documento no ZapSign.` };
  }
  const unicos = new Map(escolhidos.map((c) => [c.e.token, c.e]));
  return { envelopes: [...unicos.values()].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)) };
}

/**
 * Puxa do ZapSign a Procuração, a Declaração e o Contrato assinados que faltam na pasta e grava no padrão
 * (Contratos/ e Não juntar/). Depois refaz o inventário para a classificação já ver esses arquivos no lugar.
 */
export function etapaZapsign(fonte: () => FonteZapsign | null): Etapa {
  return {
    nome: 'zapsign',
    saida: 'zapsign.json',
    async executar(ctx) {
      const arquivoInventario = join(ctx.pastaJob, 'inventario.json');
      const inventario = JSON.parse(readFileSync(arquivoInventario, 'utf8')) as Inventario;
      const naPasta = new Set(inventario.arquivos.flatMap((a) => ((a.situacao === 'no-lugar' || a.situacao === 'mover') && 'tipo' in a ? [a.tipo] : [])));
      const faltam = DOCUMENTOS_ASSINADOS.filter((t) => !naPasta.has(t));
      if (faltam.length === 0) return { status: 'pulada', motivo: 'Procuração, declaração e contrato já estão na pasta; não precisei do ZapSign.' };

      const z = fonte();
      if (!z) return { status: 'pendente', motivo: MENSAGEM_SEM_TOKEN };

      const busca = interpretarBusca(ctx.job.buscaZapsign?.trim() || ctx.job.nome);
      ctx.log(`Procurando ${busca.tipo === 'nome' ? `"${busca.valor}"` : busca.valor} no ZapSign…`);

      const feitos: Feito[] = [];
      const baixados: { tipo: DocumentoAssinado; destino: string; documento: string; envelope: string }[] = [];
      const naoAssinados: EnvelopeDetalhe[] = [];
      const restantes = new Set<DocumentoAssinado>(faltam);
      const temFaltante = (env: EnvelopeDetalhe) =>
        env.documentos.some((d) => {
          const tipo = tipoDoAssinado(d.nome);
          return tipo !== null && restantes.has(tipo);
        });
      try {
        const achados = await acharEnvelopes(z, busca);
        if ('pendente' in achados) return { status: 'pendente', motivo: achados.pendente };

        for (const env of achados.envelopes.slice(0, MAX_ENVELOPES)) {
          if (restantes.size === 0) break;
          const detalhe = await z.detalhar(env.token);
          if (detalhe.status !== 'signed') {
            naoAssinados.push(detalhe);
            continue;
          }
          const assinantes = detalhe.signatarios.map((s) => s.nome).join(', ');
          ctx.log(`Envelope de ${data(detalhe.criadoEm)} assinado (${assinantes}).`);
          for (const doc of detalhe.documentos) {
            const tipo = tipoDoAssinado(doc.nome);
            if (!tipo) {
              ctx.log(`"${doc.nome}" está no envelope, mas não é procuração, declaração nem contrato; deixei no ZapSign.`, 'aviso');
              continue;
            }
            if (!restantes.has(tipo) || !doc.arquivoAssinado) continue;
            const destino = nomeFinal(tipo, '.pdf');
            const pdf = await z.baixar(doc.arquivoAssinado);
            gravarNoLugar(ctx.job.pasta, destino, pdf, feitos);
            restantes.delete(tipo);
            baixados.push({ tipo, destino, documento: doc.nome, envelope: detalhe.token });
            ctx.log(`ZapSign: ${doc.nome} → ${destino}`);
          }
        }
        if (baixados.length > 0) inventariar(ctx.job.pasta, arquivoInventario);
        if (restantes.size > 0) {
          const lista = [...restantes].join(', ');
          const esperando = naoAssinados.find(temFaltante);
          const motivo = esperando
            ? `O envelope de ${data(esperando.criadoEm)} no ZapSign ainda não foi assinado; faltam ${lista}. Quando o cliente assinar, clique em Tentar de novo.`
            : `Achei o cliente no ZapSign, mas não encontrei ${lista} assinado(s) nos envelopes dele.`;
          return { status: 'pendente', motivo };
        }
      } catch (erro) {
        if (baixados.length > 0) inventariar(ctx.job.pasta, arquivoInventario);
        return { status: 'pendente', motivo: `ZapSign: ${erro instanceof Error ? erro.message : String(erro)}` };
      }

      writeFileSync(join(ctx.pastaJob, 'zapsign.json'), JSON.stringify({ busca, baixados, feitos, quando: new Date().toISOString() }, null, 2));
      return { status: 'ok' };
    },
  };
}
