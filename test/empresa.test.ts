import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { etapaEmpresa, normalizarCnpj, pendenciasDaEmpresa, type AnaliseEmpresa } from '../src/main/etapas/empresa';
import { gerarPdfEntrevista } from '../src/main/etapas/pdf-entrevista';
import { anotacao } from '../src/main/etapas/planilha';
import { ARQUIVO_CONVERSA } from '../src/main/etapas/whatsapp';
import { extrairTexto } from '../src/main/ferramentas/pdf';
import { Fila } from '../src/main/fila';
import type { Contexto } from '../src/main/job';
import type { Pedido, Provedor } from '../src/main/provedores/tipos';

function provedorFalso(resposta: unknown, pedidos: Pedido[] = []): Provedor {
  return {
    id: 'claude',
    nome: 'Falso',
    status: async () => ({ instalado: true, logado: true, conta: 'x', caminho: 'x' }),
    rodar: async (p) => {
      pedidos.push(p);
      return resposta;
    },
  };
}

async function pdfComTexto(destino: string, linhas: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument();
    const s = doc.pipe(createWriteStream(destino));
    for (const l of linhas) doc.text(l);
    doc.end();
    s.on('finish', () => resolve());
    s.on('error', reject);
  });
}

/** CTPS digital (com texto) com dois contratos: o da padaria é antigo, o da empresa de limpeza serve. */
const CTPS = [
  'Carteira de Trabalho Digital',
  'Contratos de trabalho',
  'LIMPA TUDO SERVICOS LTDA - CNPJ 00.000.000/0001-91',
  'Cargo: Auxiliar de limpeza - Admissão 01/03/2024 - Desligamento 10/06/2026',
  'PADARIA PAO QUENTE LTDA - CNPJ 11.222.333/0001-81',
  'Cargo: Atendente - Admissão 01/01/2018 - Desligamento 15/02/2020',
  'Este documento foi gerado pelo aplicativo Carteira de Trabalho Digital e tem validade em todo o território nacional.',
];

async function preparar({ comCtps = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'empresa-'));
  const cliente = join(dir, 'Lúcia Helena Araújo');
  const pastaJob = join(dir, 'job');
  mkdirSync(join(cliente, 'Documentos'), { recursive: true });
  mkdirSync(pastaJob);
  if (comCtps) await pdfComTexto(join(cliente, 'Documentos', 'CTPS.pdf'), CTPS);
  writeFileSync(join(pastaJob, 'dados-cliente.json'), JSON.stringify({ nome: 'Lúcia Helena Araújo', cargo: 'Auxiliar de limpeza' }));
  writeFileSync(join(pastaJob, 'perguntas.json'), JSON.stringify([{ numero: 1, secao: 'Local de trabalho', pergunta: 'Qual era o endereço onde você trabalhava?', simNao: false }]));
  writeFileSync(join(pastaJob, 'transcricao.txt'), 'Atendente: onde você trabalhava? Cliente: eu limpava o Hospital Bom Pastor, mas quem pagava era a Limpa Tudo.');
  writeFileSync(join(pastaJob, ARQUIVO_CONVERSA), '[06/10/2026 14:10] Cliente: trabalhei na Padaria Pão Quente até 2020');
  const fila = new Fila(join(dir, 'jobs.json'));
  const job = fila.adicionar(cliente);
  const mensagens: { texto: string; nivel?: string }[] = [];
  const ctx: Contexto = { fila, pastaJob, job, log: (texto, nivel) => void mensagens.push({ texto, nivel }) };
  return { cliente, pastaJob, ctx, mensagens };
}

const RESPOSTA = {
  empregadora: {
    nome: 'LIMPA TUDO SERVICOS LTDA',
    cnpj: '00000000000191',
    endereco: null,
    fontes: ['ligacao', 'ctps', 'outra'],
    cargo: 'Auxiliar de limpeza',
    admissao: '01/03/2024',
    demissao: '10/06/2026',
    confirmadaNaCtps: true,
    certeza: true,
  },
  descartadas: [{ nome: 'Padaria Pão Quente', motivo: 'saiu em 2020, mais de 2 anos' }],
  terceirizado: true,
  tomadora: { nome: null, cnpj: null, endereco: null, fontes: [] },
  justificativa: 'A empresa do caso é a Limpa Tudo (saída em 06/2026, 2 anos de contrato); ela limpava um hospital, então é terceirizada.',
};

describe('normalizarCnpj', () => {
  it('confere os dígitos verificadores (inclusive do CNPJ com letras) e formata', () => {
    expect(normalizarCnpj('00000000000191')).toBe('00.000.000/0001-91');
    expect(normalizarCnpj('00.000.000/0001-91')).toBe('00.000.000/0001-91');
    expect(normalizarCnpj('12.ABC.345/01DE-35')).toBe('12.ABC.345/01DE-35');
    expect(normalizarCnpj('00.000.000/0001-90')).toBeNull();
    expect(normalizarCnpj('11.111.111/1111-11')).toBeNull();
    expect(normalizarCnpj(null)).toBeNull();
  });
});

describe('pendenciasDaEmpresa', () => {
  const base = (): Omit<AnaliseEmpresa, 'pendencias'> => ({
    empregadora: { nome: 'X LTDA', cnpj: '00.000.000/0001-91', endereco: null, fontes: ['ctps'], cargo: null, admissao: null, demissao: null, confirmadaNaCtps: true, certeza: true },
    descartadas: [],
    terceirizado: false,
    tomadora: { nome: null, cnpj: null, endereco: null, fontes: [] },
    justificativa: '',
    ctpsNaPasta: true,
  });

  it('caso limpo não tem pendência', () => {
    expect(pendenciasDaEmpresa(base())).toEqual([]);
  });

  it('terceirizado sem tomadora pede os dados explicando o porquê; com nome e sem CNPJ, pede o CNPJ', () => {
    const sem = pendenciasDaEmpresa({ ...base(), terceirizado: true });
    expect(sem.map((p) => p.curta)).toEqual(['solicitar dados da tomadora']);
    expect(sem[0].texto).toMatch(/responde pelos direitos dele se a empregadora não pagar \(Súmula 331 do TST\)/);
    const semCnpj = pendenciasDaEmpresa({ ...base(), terceirizado: true, tomadora: { nome: 'Hospital Bom Pastor', cnpj: null, endereco: null, fontes: ['ligacao'] } });
    expect(semCnpj.map((p) => p.curta)).toEqual(['CNPJ da tomadora']);
  });

  it('sem certeza pede para confirmar a empresa; fora da CTPS só avisa quando a CTPS está na pasta', () => {
    const incerta = pendenciasDaEmpresa({ ...base(), empregadora: { ...base().empregadora, certeza: false } });
    expect(incerta.map((p) => p.curta)).toEqual(['confirmar a empresa']);
    expect(incerta[0].texto).toContain('a mais provável é X LTDA');
    const fora = { ...base(), empregadora: { ...base().empregadora, confirmadaNaCtps: false, cnpj: null } };
    expect(pendenciasDaEmpresa(fora).map((p) => p.curta)).toEqual(['empresa fora da CTPS', 'CNPJ da empresa']);
    expect(pendenciasDaEmpresa({ ...fora, ctpsNaPasta: false }).map((p) => p.curta)).toEqual(['CNPJ da empresa']);
  });
});

describe('etapaEmpresa', () => {
  it('manda documento, ligação, conversa do WhatsApp, CTPS e a régua; grava a empresa e as pendências', async () => {
    const { pastaJob, ctx, mensagens } = await preparar();
    const pedidos: Pedido[] = [];
    expect(await etapaEmpresa(() => provedorFalso(RESPOSTA, pedidos)).executar(ctx)).toEqual({ status: 'ok' });

    const prompt = pedidos[0].prompt;
    expect(prompt).toContain('saiu dela há MENOS de 2 anos (ou ainda trabalha lá) E trabalhou nela MAIS de 6 meses');
    expect(prompt).toContain('Hoje é ');
    expect(prompt).toContain('Cargo: Auxiliar de limpeza');
    expect(prompt).toContain('eu limpava o Hospital Bom Pastor');
    expect(prompt).toContain('trabalhei na Padaria Pão Quente até 2020');
    expect(prompt).toContain('LIMPA TUDO SERVICOS LTDA - CNPJ 00.000.000/0001-91');
    expect(pedidos[0].imagens).toEqual([]);

    const a = JSON.parse(readFileSync(join(pastaJob, 'empresa.json'), 'utf8')) as AnaliseEmpresa;
    expect(a.empregadora).toMatchObject({ nome: 'LIMPA TUDO SERVICOS LTDA', cnpj: '00.000.000/0001-91', fontes: ['ligacao', 'ctps'], confirmadaNaCtps: true });
    expect(a.descartadas).toEqual([{ nome: 'Padaria Pão Quente', motivo: 'saiu em 2020, mais de 2 anos' }]);
    expect(a.pendencias.map((p) => p.curta)).toEqual(['solicitar dados da tomadora']);
    expect(mensagens.some((m) => m.nivel === 'aviso' && m.texto.startsWith('Solicitar ao cliente o nome e o CNPJ da empresa tomadora'))).toBe(true);
    expect(mensagens.map((m) => m.texto)).toContain('Empresa: LIMPA TUDO SERVICOS LTDA (00.000.000/0001-91), confirmada na CTPS.');
  });

  it('sem CTPS na pasta não aceita "confirmada na CTPS"; CNPJ com dígito errado é descartado', async () => {
    const { pastaJob, ctx } = await preparar({ comCtps: false });
    const pedidos: Pedido[] = [];
    const resposta = { ...RESPOSTA, terceirizado: false, empregadora: { ...RESPOSTA.empregadora, cnpj: '12.345.678/0001-00' } };
    await etapaEmpresa(() => provedorFalso(resposta, pedidos)).executar(ctx);
    expect(pedidos[0].prompt).toContain('(a CTPS não está na pasta)');
    const a = JSON.parse(readFileSync(join(pastaJob, 'empresa.json'), 'utf8')) as AnaliseEmpresa;
    expect(a.empregadora.confirmadaNaCtps).toBe(false);
    expect(a.empregadora.cnpj).toBeNull();
    expect(a.pendencias.map((p) => p.curta)).toEqual(['CNPJ da empresa']);
  });
});

describe('empresa no PDF e na planilha', () => {
  const analise: AnaliseEmpresa = {
    empregadora: {
      nome: 'LIMPA TUDO SERVICOS LTDA',
      cnpj: '00.000.000/0001-91',
      endereco: 'Rua A, 10, Centro, Belo Horizonte/MG',
      fontes: ['ctps'],
      cargo: 'Auxiliar de limpeza',
      admissao: '01/03/2024',
      demissao: '10/06/2026',
      confirmadaNaCtps: true,
      certeza: true,
    },
    descartadas: [{ nome: 'Padaria Pão Quente', motivo: 'saiu em 2020' }],
    terceirizado: true,
    tomadora: { nome: null, cnpj: null, endereco: null, fontes: [] },
    justificativa: 'Limpava um hospital pela Limpa Tudo.',
    ctpsNaPasta: true,
    pendencias: pendenciasDaEmpresa({
      empregadora: { nome: 'X', cnpj: '00.000.000/0001-91', endereco: null, fontes: [], cargo: null, admissao: null, demissao: null, confirmadaNaCtps: true, certeza: true },
      descartadas: [],
      terceirizado: true,
      tomadora: { nome: null, cnpj: null, endereco: null, fontes: [] },
      justificativa: '',
      ctpsNaPasta: true,
    }),
  };

  it('o PDF da entrevista mostra a empresa do processo, a tomadora e as pendências', async () => {
    const destino = join(mkdtempSync(join(tmpdir(), 'pdf-empresa-')), 'Entrevista preenchida.pdf');
    await gerarPdfEntrevista({
      destino,
      cliente: 'Lúcia Helena Araújo',
      dadosCliente: { empresa: 'Nome antigo do cadastro' },
      empresa: analise,
      perguntas: [{ numero: 1, secao: 'Local de trabalho', pergunta: 'Onde trabalhava?', simNao: false }],
      respostas: [{ numero: 1, simNao: null, resposta: 'No hospital.', naoRespondida: false }],
      transcricao: 'Atendente: oi',
    });
    const texto = (await extrairTexto(destino, 3)).replace(/\s+/g, ' ');
    expect(texto).toContain('EMPRESA DO PROCESSO');
    expect(texto).toContain('Empregadora: LIMPA TUDO SERVICOS LTDA · CNPJ 00.000.000/0001-91');
    expect(texto).toContain('Contrato: Auxiliar de limpeza · admissão 01/03/2024 · saída 10/06/2026');
    expect(texto).toContain('Tomadora de serviços: caso terceirizado, sem os dados da tomadora');
    expect(texto).toContain('Descartadas: Padaria Pão Quente (saiu em 2020)');
    expect(texto).toContain('Pendências');
    expect(texto).toContain('Súmula 331 do TST');
    // o nome do cadastro não aparece duplicado no cabeçalho
    expect(texto).not.toContain('Nome antigo do cadastro');
  });

  it('a anotação da planilha leva o que ainda precisa ser pedido', () => {
    const pastaJob = mkdtempSync(join(tmpdir(), 'anot-'));
    expect(anotacao(pastaJob)).toMatch(/^\d\d\/\d\d Robô: pasta organizada pelo app$/);
    writeFileSync(join(pastaJob, 'empresa.json'), JSON.stringify(analise));
    expect(anotacao(pastaJob)).toMatch(/^\d\d\/\d\d Robô: pasta organizada pelo app\. Pendente: solicitar dados da tomadora$/);
  });
});
