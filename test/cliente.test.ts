import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { escolherLinha, etapaCliente, MENSAGEM_SEM_PLANILHA, nomeDoCliente } from '../src/main/etapas/cliente';
import { etapaPlanilha, faltandoNaPasta } from '../src/main/etapas/planilha';
import { Fila, type Job } from '../src/main/fila';
import type { FontePlanilha, LinhaPlanilha, ResultadoMarcacao } from '../src/main/ferramentas/planilha';
import type { FonteZapsign } from '../src/main/ferramentas/zapsign';
import type { Contexto } from '../src/main/job';

const linha = (n: number, nome: string, telefone: string, grau: 'igual' | 'parecido' = 'igual', pastaPronta = ''): LinhaPlanilha & { grau: 'igual' | 'parecido' } => ({
  linha: n,
  nome,
  telefone,
  pastaPronta,
  observacoes: '',
  grau,
});

function planilhaFalsa(linhas: (LinhaPlanilha & { grau: 'igual' | 'parecido' })[], resultado: ResultadoMarcacao = { status: 'marcado', linha: 9 }) {
  const marcacoes: { cliente: { nome: string; telefone: string }; anotacao: string }[] = [];
  const fonte: FontePlanilha = {
    procurarPorNome: async () => linhas,
    marcarPastaPronta: async (cliente, anotacao) => {
      marcacoes.push({ cliente, anotacao });
      return resultado;
    },
  };
  return { fonte, marcacoes };
}

function zapsignCom(telefone: string, nome = 'Lúcia Helena Araújo'): FonteZapsign {
  return {
    buscarPorNome: async () => ({ envelopes: [{ token: 't', nome: 'Declaração de pobreza.docx', status: 'signed', criadoEm: '2026-10-06', signatarios: [{ nome, status: 'assinou', telefone }] }], desde: '2025-10-21' }),
    buscarPorEmail: async () => [],
    detalhar: async () => {
      throw new Error('não usado');
    },
    baixar: async () => Buffer.from(''),
  };
}

function contexto(extra: Partial<Job> = {}, nomePasta = 'Lúcia Helena Araújo - Acme') {
  const dir = mkdtempSync(join(tmpdir(), 'cli-'));
  const pasta = join(dir, nomePasta);
  const pastaJob = join(dir, 'job');
  mkdirSync(pasta);
  mkdirSync(pastaJob);
  const fila = new Fila(join(dir, 'jobs.json'));
  const job = { ...fila.adicionar(pasta), ...extra };
  const mensagens: string[] = [];
  const ctx: Contexto = { fila, pastaJob, job, log: (t) => void mensagens.push(t) };
  return { ctx, pasta, pastaJob, mensagens };
}

describe('escolherLinha (nome e número conferidos)', () => {
  const eli = linha(9, 'Lúcia Helena Araújo', '(31) 97654-3210');

  it('uma linha só com o nome: aceita', () => {
    expect(escolherLinha('Lúcia Helena Araújo', [eli], null, [])).toEqual({ linha: eli, por: 'unico-na-planilha' });
  });
  it('nome repetido: escolhe pelo telefone do ZapSign', () => {
    const outra = linha(40, 'Lúcia Helena Araújo', '(11) 91111-2222');
    expect(escolherLinha('Lúcia Helena Araújo', [outra, eli], null, ['+55 31976543210'])).toEqual({ linha: eli, por: 'zapsign' });
  });
  it('telefone da planilha diferente do ZapSign: não confirma', () => {
    const r = escolherLinha('Lúcia Helena Araújo', [eli], null, ['+55 11955554444']);
    expect('pendente' in r && r.pendente).toMatch(/telefone da planilha \(\(31\) 97654-3210, linha 9\) é diferente do que o cliente usou no ZapSign \(\(11\) 95555-4444\)/);
  });
  it('sem ZapSign, confirma pelo telefone do documento da entrevista', () => {
    const outra = linha(40, 'Lúcia Helena Araújo', '(32) 91111-2222');
    expect(escolherLinha('Lúcia Helena Araújo', [outra, eli], null, [], '31976543210')).toEqual({ linha: eli, por: 'entrevista' });
  });

  it('telefone da entrevista diferente da planilha: não confirma e diz os dois números', () => {
    const r = escolherLinha('Lúcia Helena Araújo', [eli], null, [], '(32) 95555-4444') as { pendente: string };
    expect(r.pendente).toContain('documento da entrevista');
    expect(r.pendente).toContain('(31) 97654-3210');
  });

  it('nome igual tem preferência sobre parecido', () => {
    const parecida = linha(50, 'Lúcia Araújo', '(21) 90000-0000', 'parecido');
    expect(escolherLinha('Lúcia Helena Araújo', [parecida, eli], null, [])).toEqual({ linha: eli, por: 'unico-na-planilha' });
  });
  it('várias linhas parecidas sem ZapSign: pede o telefone', () => {
    const a = linha(11, 'Maria Souza', '(51) 99999-1111');
    const b = linha(12, 'Maria Souza', '(51) 98888-2222');
    const r = escolherLinha('Maria Souza', [a, b], null, []);
    expect('pendente' in r && r.pendente).toMatch(/Há 2 linhas parecidas.*Maria Souza, \(51\) 99999-1111 \(linha 11\); Maria Souza, \(51\) 98888-2222 \(linha 12\)\. Informe abaixo/);
    expect(escolherLinha('Maria Souza', [a, b], '51988882222', [])).toEqual({ linha: b, por: 'informado' });
  });
  it('não está na planilha', () => {
    const r = escolherLinha('Fulano de Tal', [], null, []);
    expect('pendente' in r && r.pendente).toMatch(/Não achei "Fulano de Tal" na planilha/);
  });
});

describe('etapaCliente', () => {
  it('usa o nome do documento da entrevista, confirma pelo ZapSign e grava cliente.json', async () => {
    const { ctx, pastaJob, mensagens } = contexto();
    writeFileSync(join(pastaJob, 'dados-cliente.json'), JSON.stringify({ nome: 'Lúcia Helena Araújo', empresa: 'ACME' }));
    expect(nomeDoCliente(ctx)).toBe('Lúcia Helena Araújo');
    const { fonte } = planilhaFalsa([linha(195, 'Lúcia Helena Araújo', '(31) 97654-3210')]);
    const r = await etapaCliente({ planilha: () => fonte, zapsign: () => zapsignCom('+55 31976543210') }).executar(ctx);
    expect(r).toEqual({ status: 'ok' });
    expect(JSON.parse(readFileSync(join(pastaJob, 'cliente.json'), 'utf8'))).toEqual({ nome: 'Lúcia Helena Araújo', telefone: '31976543210', linha: 195, confirmadoPor: 'zapsign' });
    expect(mensagens[0]).toBe('Cliente confirmado: Lúcia Helena Araújo, (31) 97654-3210, linha 195 da planilha (mesmo telefone do ZapSign).');
  });

  it('nome e telefone informados na tela valem mais que a entrevista', async () => {
    const { ctx } = contexto({ cliente: { nome: 'Maria Souza', telefone: '(51) 98888-2222' } });
    const { fonte } = planilhaFalsa([linha(11, 'Maria Souza', '(51) 99999-1111'), linha(12, 'Maria Souza', '(51) 98888-2222')]);
    expect(nomeDoCliente(ctx)).toBe('Maria Souza');
    expect(await etapaCliente({ planilha: () => fonte, zapsign: () => null }).executar(ctx)).toEqual({ status: 'ok' });
  });

  it('sem planilha configurada ou telefone digitado errado: pendente explicando', async () => {
    const { ctx } = contexto({ cliente: { telefone: '1234' } });
    expect(await etapaCliente({ planilha: () => null, zapsign: () => null }).executar(ctx)).toEqual({ status: 'pendente', motivo: MENSAGEM_SEM_PLANILHA });
    const { fonte } = planilhaFalsa([]);
    const r = await etapaCliente({ planilha: () => fonte, zapsign: () => null }).executar(ctx);
    expect(r.status === 'pendente' && r.motivo).toMatch(/não parece um número com DDD/);
  });
});

function pastaCompleta(pasta: string, sem: string[] = []) {
  for (const rel of ['Contratos/Procuração.pdf', 'Contratos/Declaração.pdf', 'Documentos/RG.pdf', 'Documentos/CTPS.pdf', 'Não juntar/Contrato Trabalhista.pdf', 'Entrevista/Entrevista preenchida.pdf']) {
    if (sem.includes(rel)) continue;
    mkdirSync(join(pasta, dirname(rel)), { recursive: true });
    writeFileSync(join(pasta, rel), '%PDF');
  }
}

describe('etapaPlanilha', () => {
  const clienteJson = { nome: 'Lúcia Helena Araújo', telefone: '31976543210', linha: 195, confirmadoPor: 'zapsign' };

  it('pasta completa: marca Sim com a anotação do dia e grava planilha.json', async () => {
    const { ctx, pasta, pastaJob, mensagens } = contexto();
    pastaCompleta(pasta);
    writeFileSync(join(pastaJob, 'cliente.json'), JSON.stringify(clienteJson));
    const { fonte, marcacoes } = planilhaFalsa([], { status: 'marcado', linha: 195 });
    expect(await etapaPlanilha(() => fonte).executar(ctx)).toEqual({ status: 'ok' });
    expect(marcacoes).toHaveLength(1);
    expect(marcacoes[0].cliente).toEqual({ nome: 'Lúcia Helena Araújo', telefone: '31976543210' });
    expect(marcacoes[0].anotacao).toMatch(/^\d{2}\/\d{2} Robô: pasta organizada pelo app$/);
    expect(mensagens[0]).toBe('Planilha: linha 195 marcada como Pasta pronta = Sim, com o marcador verde e a anotação em Observações.');
    expect(existsSync(join(pastaJob, 'planilha.json'))).toBe(true);
  });

  it('com etapa pendente ou documento faltando, não marca', async () => {
    const pend = contexto({ etapasPendentes: ['whatsapp', 'planilha'] });
    pastaCompleta(pend.pasta);
    writeFileSync(join(pend.pastaJob, 'cliente.json'), JSON.stringify(clienteJson));
    const { fonte, marcacoes } = planilhaFalsa([]);
    const r1 = await etapaPlanilha(() => fonte).executar(pend.ctx);
    expect(r1.status === 'pendente' && r1.motivo).toBe('A planilha só é marcada com a pasta completa. Falta resolver: WhatsApp.');

    const falta = contexto();
    pastaCompleta(falta.pasta, ['Documentos/CTPS.pdf', 'Documentos/RG.pdf']);
    writeFileSync(join(falta.pastaJob, 'cliente.json'), JSON.stringify(clienteJson));
    expect(faltandoNaPasta(falta.pasta)).toEqual(['RG ou CNH', 'CTPS']);
    const r2 = await etapaPlanilha(() => fonte).executar(falta.ctx);
    expect(r2.status === 'pendente' && r2.motivo).toBe('Falta na pasta: RG ou CNH, CTPS. Não marquei a planilha.');
    expect(marcacoes).toEqual([]);
  });

  it('"Não" na planilha é decisão da equipe: fica pendente avisando', async () => {
    const { ctx, pasta, pastaJob } = contexto();
    pastaCompleta(pasta);
    writeFileSync(join(pastaJob, 'cliente.json'), JSON.stringify(clienteJson));
    const { fonte } = planilhaFalsa([], { status: 'nao', linha: 195 });
    const r = await etapaPlanilha(() => fonte).executar(ctx);
    expect(r.status === 'pendente' && r.motivo).toMatch(/está como "Não", uma decisão da equipe\. Não mudei\./);
    expect(existsSync(join(pastaJob, 'planilha.json'))).toBe(false);
  });
});

describe('nome da pasta como último recurso', () => {
  it('"arquivos-Fulano-de-Tal" vira "Fulano de Tal"', () => {
    const { ctx } = contexto({}, 'arquivos-Paulo-de-Tarso-Ramos-Lima');
    expect(nomeDoCliente(ctx)).toBe('Paulo de Tarso Ramos Lima');
  });
});
