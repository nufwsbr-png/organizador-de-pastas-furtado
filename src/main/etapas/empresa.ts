import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Etapa } from '../job';
import { extrairTexto, rasterizar } from '../ferramentas/pdf';
import { nomeFinal } from '../padrao';
import { PROMPT_EMPRESA } from '../prompts';
import type { Provedor } from '../provedores/tipos';
import type { DadosCliente, Pergunta } from './perguntas';
import { ARQUIVO_CONVERSA } from './whatsapp';

const FONTES = ['entrevista', 'ligacao', 'whatsapp', 'ctps'] as const;
export type FonteEmpresa = (typeof FONTES)[number];

export interface Tomadora {
  nome: string | null;
  cnpj: string | null;
  endereco: string | null;
  fontes: FonteEmpresa[];
}

export interface Empregadora extends Tomadora {
  cargo: string | null;
  admissao: string | null;
  demissao: string | null;
  confirmadaNaCtps: boolean;
  certeza: boolean;
}

/** O que a equipe precisa fazer: `curta` vai para Observações da planilha, `texto` para o PDF e o app. */
export interface Pendencia {
  curta: string;
  texto: string;
}

export interface AnaliseEmpresa {
  empregadora: Empregadora;
  descartadas: { nome: string; motivo: string }[];
  terceirizado: boolean;
  tomadora: Tomadora;
  justificativa: string;
  ctpsNaPasta: boolean;
  pendencias: Pendencia[];
}

const textoOuNulo = { type: ['string', 'null'] };
const fontes = { type: 'array', items: { type: 'string', enum: [...FONTES] } };
const camposEmpresa = { nome: textoOuNulo, cnpj: textoOuNulo, endereco: textoOuNulo, fontes };

export const SCHEMA_EMPRESA = {
  type: 'object',
  properties: {
    empregadora: {
      type: 'object',
      properties: {
        ...camposEmpresa,
        cargo: textoOuNulo,
        admissao: textoOuNulo,
        demissao: textoOuNulo,
        confirmadaNaCtps: { type: 'boolean' },
        certeza: { type: 'boolean' },
      },
      required: ['nome', 'cnpj', 'endereco', 'fontes', 'cargo', 'admissao', 'demissao', 'confirmadaNaCtps', 'certeza'],
      additionalProperties: false,
    },
    descartadas: {
      type: 'array',
      items: { type: 'object', properties: { nome: { type: 'string' }, motivo: { type: 'string' } }, required: ['nome', 'motivo'], additionalProperties: false },
    },
    terceirizado: { type: 'boolean' },
    tomadora: { type: 'object', properties: camposEmpresa, required: ['nome', 'cnpj', 'endereco', 'fontes'], additionalProperties: false },
    justificativa: { type: 'string' },
  },
  required: ['empregadora', 'descartadas', 'terceirizado', 'tomadora', 'justificativa'],
  additionalProperties: false,
};

/** CNPJ com os dígitos verificadores certos (numérico ou o alfanumérico de 2026), formatado; null se não for válido. */
export function normalizarCnpj(valor: unknown): string | null {
  const c = String(valor ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c) || /^(.)\1{13}$/.test(c)) return null;
  const digito = (base: string) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += (base.charCodeAt(base.length - 1 - i) - 48) * ((i % 8) + 2);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = digito(c.slice(0, 12));
  const d2 = digito(c.slice(0, 12) + d1);
  if (`${d1}${d2}` !== c.slice(12)) return null;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

const limpo = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const fontesValidas = (v: unknown): FonteEmpresa[] => (Array.isArray(v) ? [...new Set(v.filter((f): f is FonteEmpresa => FONTES.includes(f)))] : []);

function limparTomadora(t: Partial<Tomadora> | undefined): Tomadora {
  return { nome: limpo(t?.nome), cnpj: normalizarCnpj(t?.cnpj), endereco: limpo(t?.endereco), fontes: fontesValidas(t?.fontes) };
}

/** O que a equipe precisa pedir ou conferir, sempre com o mesmo texto (a IA só traz os fatos). */
export function pendenciasDaEmpresa(a: Omit<AnaliseEmpresa, 'pendencias'>): Pendencia[] {
  const p: Pendencia[] = [];
  const e = a.empregadora;
  if (!e.nome || !e.certeza) {
    p.push({
      curta: 'confirmar a empresa',
      texto: `Confirmar com o cliente qual é a empresa do processo${e.nome ? ` (a mais provável é ${e.nome})` : ''}: a entrevista, a conversa e a CTPS não deram certeza.`,
    });
  } else {
    if (a.ctpsNaPasta && !e.confirmadaNaCtps) {
      p.push({ curta: 'empresa fora da CTPS', texto: `Conferir o vínculo com ${e.nome}: a empresa não aparece na CTPS (pode ter sido trabalho sem registro).` });
    }
    if (!e.cnpj) p.push({ curta: 'CNPJ da empresa', texto: `Conferir o CNPJ de ${e.nome}: não está na entrevista, na conversa nem na CTPS.` });
  }
  if (a.terceirizado) {
    const t = a.tomadora;
    if (!t.nome) {
      p.push({
        curta: 'solicitar dados da tomadora',
        texto:
          'Solicitar ao cliente o nome e o CNPJ da empresa tomadora (onde ele trabalhava como terceirizado): ela responde pelos direitos dele se a empregadora não pagar (Súmula 331 do TST), por isso entra no processo.',
      });
    } else if (!t.cnpj) {
      p.push({
        curta: 'CNPJ da tomadora',
        texto: `Solicitar ao cliente o CNPJ ou o endereço da tomadora ${t.nome}: ela responde pelos direitos dele se a empregadora não pagar, por isso entra no processo.`,
      });
    }
  }
  return p;
}

/** Dados da empresa que o documento da entrevista já traz (cabeçalho e respostas preenchidas). */
export function dadosDoDocumento(dados: DadosCliente, perguntas: Pergunta[]): string {
  const rotulos: [keyof DadosCliente, string][] = [
    ['empresa', 'Empresa'],
    ['cnpjEmpresa', 'CNPJ da empresa'],
    ['enderecoEmpresa', 'Endereço da empresa'],
    ['cargo', 'Cargo'],
    ['vinculo', 'Vínculo'],
    ['salario', 'Salário'],
    ['admissao', 'Admissão'],
    ['demissao', 'Demissão'],
  ];
  const linhas = rotulos.filter(([k]) => dados[k]).map(([k, r]) => `${r}: ${dados[k]}`);
  const respondidas = perguntas.filter((p) => p.respostaNoPdf).map((p) => `${p.pergunta}: ${p.respostaNoPdf}`);
  if (respondidas.length > 0) linhas.push('', 'Respostas que já vêm preenchidas no documento:', ...respondidas);
  return linhas.length > 0 ? linhas.join('\n') : '(o documento não traz dados da empresa)';
}

/** Conversa longa: o começo (quando o cliente conta da empresa) e o fim (o que foi combinado por último). */
function cortarConversa(texto: string, limite = 60_000): string {
  if (texto.length <= limite) return texto;
  return `${texto.slice(0, limite / 3)}\n[... trecho do meio da conversa omitido ...]\n${texto.slice(-(limite * 2) / 3)}`;
}

function lerJson<T>(arquivo: string, padrao: T): T {
  return existsSync(arquivo) ? (JSON.parse(readFileSync(arquivo, 'utf8')) as T) : padrao;
}

/**
 * Confirma a empresa do processo (documento da entrevista, ligação, conversa do WhatsApp e CTPS, com a régua do
 * escritório) e se o caso tem tomadora de serviços. O que faltar vira pendência no PDF, no app e na planilha,
 * mas não segura a pasta.
 */
export function etapaEmpresa(provedor: () => Provedor): Etapa {
  return {
    nome: 'empresa',
    saida: 'empresa.json',
    dependeDe: ['perguntas', 'transcricao'],
    async executar(ctx) {
      const dados = lerJson<DadosCliente>(join(ctx.pastaJob, 'dados-cliente.json'), {});
      const perguntas = lerJson<Pergunta[]>(join(ctx.pastaJob, 'perguntas.json'), []);
      const transcricao = existsSync(join(ctx.pastaJob, 'transcricao.txt')) ? readFileSync(join(ctx.pastaJob, 'transcricao.txt'), 'utf8') : '';
      const conversa = existsSync(join(ctx.pastaJob, ARQUIVO_CONVERSA)) ? readFileSync(join(ctx.pastaJob, ARQUIVO_CONVERSA), 'utf8') : '';

      const ctps = join(ctx.job.pasta, nomeFinal('CTPS', '.pdf'));
      const ctpsNaPasta = existsSync(ctps);
      let ctpsTexto = '';
      let ctpsImagens: string[] = [];
      if (ctpsNaPasta) {
        ctpsTexto = (await extrairTexto(ctps, 40).catch(() => '')).trim();
        // CTPS digital tem texto; a física (fotos juntadas em PDF) precisa ser vista
        if (ctpsTexto.length < 300) ctpsImagens = await rasterizar(ctps, join(ctx.pastaJob, 'ctps-png'), { maxPaginas: 8, escala: 1.5 });
      }

      ctx.log(`Confirmando a empresa${conversa ? ' (entrevista, ligação, WhatsApp' : ' (entrevista, ligação'}${ctpsNaPasta ? ' e CTPS)' : '; sem CTPS na pasta)'}…`);
      const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const r = (await provedor().rodar({
        prompt: PROMPT_EMPRESA({ hoje, documento: dadosDoDocumento(dados, perguntas), transcricao: transcricao.slice(0, 80_000), conversa: cortarConversa(conversa), ctpsTexto: ctpsTexto.slice(0, 40_000), ctpsImagens }),
        schema: SCHEMA_EMPRESA,
        imagens: ctpsImagens,
        cwd: ctx.pastaJob,
        nomeTarefa: 'empresa',
      })) as Partial<Omit<AnaliseEmpresa, 'pendencias' | 'ctpsNaPasta'>>;

      const e = r.empregadora;
      const sem = {
        empregadora: {
          ...limparTomadora(e),
          cargo: limpo(e?.cargo),
          admissao: limpo(e?.admissao),
          demissao: limpo(e?.demissao),
          confirmadaNaCtps: ctpsNaPasta && Boolean(e?.confirmadaNaCtps),
          certeza: Boolean(e?.certeza),
        },
        descartadas: (r.descartadas ?? []).map((d) => ({ nome: String(d.nome ?? '').trim(), motivo: String(d.motivo ?? '').trim() })).filter((d) => d.nome),
        terceirizado: Boolean(r.terceirizado),
        tomadora: r.terceirizado ? limparTomadora(r.tomadora) : { nome: null, cnpj: null, endereco: null, fontes: [] },
        justificativa: String(r.justificativa ?? '').trim(),
        ctpsNaPasta,
      };
      const analise: AnaliseEmpresa = { ...sem, pendencias: pendenciasDaEmpresa(sem) };
      writeFileSync(join(ctx.pastaJob, 'empresa.json'), JSON.stringify(analise, null, 2));

      const emp = analise.empregadora;
      ctx.log(
        emp.nome
          ? `Empresa: ${emp.nome}${emp.cnpj ? ` (${emp.cnpj})` : ''}${emp.confirmadaNaCtps ? ', confirmada na CTPS' : ''}${emp.certeza ? '' : ', sem certeza'}.`
          : 'Não consegui identificar a empresa do processo.',
      );
      if (analise.terceirizado) ctx.log(`Caso terceirizado: tomadora ${analise.tomadora.nome ?? 'sem dados nas fontes'}.`);
      for (const p of analise.pendencias) ctx.log(p.texto, 'aviso');
      return { status: 'ok' };
    },
  };
}
