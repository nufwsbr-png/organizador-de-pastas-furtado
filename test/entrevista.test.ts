import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'node:fs';
import { Fila } from '../src/main/fila';
import { inventariar } from '../src/main/etapas/inventario';
import { etapaPerguntas, validarPerguntas, type Pergunta } from '../src/main/etapas/perguntas';
import { etapaRespostas, type Resposta } from '../src/main/etapas/respostas';
import { etapaPdfEntrevista, gerarPdfEntrevista } from '../src/main/etapas/pdf-entrevista';
import { extrairTexto, contarPaginas } from '../src/main/ferramentas/pdf';
import type { Contexto } from '../src/main/job';
import type { Pedido, Provedor } from '../src/main/provedores/tipos';

const PASTA_REAL = 'C:\\Users\\Computador08\\Downloads\\Elisângela Cristina Mariano';

const perguntasExemplo: Pergunta[] = [
  { numero: 1, secao: 'Local de trabalho', pergunta: 'Qual era o endereço do lugar onde você trabalhava?', simNao: false },
  { numero: 2, secao: 'Saída e atividades', pergunta: 'Qual foi o motivo de sua saída?', simNao: false },
  { numero: 3, secao: 'Saída e atividades', pergunta: 'Já trabalhou em outro horário?', simNao: true },
];

function provedorFalso(resposta: unknown, pedidos: Pedido[] = []): Provedor {
  return {
    id: 'claude',
    nome: 'Falso',
    status: async () => ({ instalado: true, logado: true, conta: 'x', caminho: 'x' }),
    rodar: async (p) => {
      pedidos.push(p);
      return typeof resposta === 'function' ? (resposta as (p: Pedido) => unknown)(p) : resposta;
    },
  };
}

async function pdfSimples(destino: string, paginas = 2): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument();
    const s = doc.pipe(createWriteStream(destino));
    for (let i = 0; i < paginas; i++) {
      if (i > 0) doc.addPage();
      doc.text(`Página ${i + 1}`);
    }
    doc.end();
    s.on('finish', () => resolve());
    s.on('error', reject);
  });
}

async function preparar(opcoes: { perguntasPdf?: boolean; transcricao?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ent-'));
  const cliente = join(dir, 'Maria Souza');
  const pastaJob = join(dir, 'job');
  mkdirSync(cliente);
  mkdirSync(pastaJob);
  if (opcoes.perguntasPdf !== false) await pdfSimples(join(cliente, 'Perguntas entrevista .pdf'), 2);
  inventariar(cliente, join(pastaJob, 'inventario.json'));
  if (opcoes.transcricao) writeFileSync(join(pastaJob, 'transcricao.txt'), opcoes.transcricao);
  const fila = new Fila(join(dir, 'jobs.json'));
  const job = fila.adicionar(cliente);
  const mensagens: string[] = [];
  const ctx: Contexto = { fila, pastaJob, job, log: (t) => mensagens.push(t) };
  return { cliente, pastaJob, ctx, mensagens };
}

describe('etapaPerguntas', () => {
  it('rasteriza o PDF de perguntas, manda as páginas para a IA e grava perguntas.json', async () => {
    const { ctx, pastaJob } = await preparar();
    const pedidos: Pedido[] = [];
    const etapa = etapaPerguntas(() => provedorFalso({ perguntas: perguntasExemplo }, pedidos));
    const r = await etapa.executar(ctx);
    expect(r.status).toBe('ok');
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].imagens).toHaveLength(2);
    expect(pedidos[0].imagens[0]).toMatch(/pagina-1\.png$/);
    expect(pedidos[0].prompt).toContain(pedidos[0].imagens[0]);
    const gravado = JSON.parse(readFileSync(join(pastaJob, 'perguntas.json'), 'utf8')) as Pergunta[];
    expect(gravado).toHaveLength(3);
  });

  it('sem PDF de perguntas a etapa fica pendente', async () => {
    const { ctx } = await preparar({ perguntasPdf: false });
    const etapa = etapaPerguntas(() => provedorFalso({ perguntas: perguntasExemplo }));
    const r = await etapa.executar(ctx);
    expect(r.status).toBe('pendente');
    expect((r as { motivo: string }).motivo).toMatch(/perguntas/i);
  });

  it('valida numeração contínua e lista vazia', () => {
    expect(validarPerguntas(perguntasExemplo)).toBeNull();
    expect(validarPerguntas([])).toMatch(/nenhuma/i);
    expect(validarPerguntas([perguntasExemplo[0], perguntasExemplo[2]])).toMatch(/numeração/i);
  });
});

describe('etapaRespostas', () => {
  it('manda perguntas e transcrição para a IA e grava respostas.json', async () => {
    const { ctx, pastaJob } = await preparar({ transcricao: '[00:00] Falante 1: Onde você trabalhava?\n\n[00:03] Falante 2: Na Rua das Flores, 10, Centro, Curitiba.' });
    writeFileSync(join(pastaJob, 'perguntas.json'), JSON.stringify(perguntasExemplo));
    const pedidos: Pedido[] = [];
    const respostas: Resposta[] = [
      { numero: 1, simNao: null, resposta: 'Rua das Flores, 10, Centro, Curitiba.', naoRespondida: false },
      { numero: 2, simNao: null, resposta: '', naoRespondida: true },
      { numero: 3, simNao: 'Não', resposta: 'Disse que sempre teve o mesmo horário.', naoRespondida: false },
    ];
    const etapa = etapaRespostas(() => provedorFalso({ respostas }, pedidos));
    const r = await etapa.executar(ctx);
    expect(r.status).toBe('ok');
    expect(pedidos[0].prompt).toContain('Rua das Flores');
    expect(pedidos[0].prompt).toContain('Qual foi o motivo de sua saída?');
    expect(pedidos[0].imagens).toEqual([]);
    const gravado = JSON.parse(readFileSync(join(pastaJob, 'respostas.json'), 'utf8')) as Resposta[];
    expect(gravado.map((x) => x.numero)).toEqual([1, 2, 3]);
  });

  it('pergunta que a IA esqueceu entra como não respondida', async () => {
    const { ctx, pastaJob } = await preparar({ transcricao: 'x' });
    writeFileSync(join(pastaJob, 'perguntas.json'), JSON.stringify(perguntasExemplo));
    const etapa = etapaRespostas(() => provedorFalso({ respostas: [{ numero: 1, simNao: null, resposta: 'a', naoRespondida: false }] }));
    await etapa.executar(ctx);
    const gravado = JSON.parse(readFileSync(join(pastaJob, 'respostas.json'), 'utf8')) as Resposta[];
    expect(gravado).toHaveLength(3);
    expect(gravado[1].naoRespondida).toBe(true);
  });
});

describe('PDF da entrevista', () => {
  it('gera o PDF com cabeçalho, perguntas, respostas e a transcrição em anexo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdf-'));
    const destino = join(dir, 'Entrevista preenchida.pdf');
    await gerarPdfEntrevista({
      destino,
      cliente: 'Maria Souza',
      perguntas: perguntasExemplo,
      respostas: [
        { numero: 1, simNao: null, resposta: 'Rua das Flores, 10.', naoRespondida: false },
        { numero: 2, simNao: null, resposta: '', naoRespondida: true },
        { numero: 3, simNao: 'Não', resposta: 'Sempre o mesmo horário.', naoRespondida: false },
      ],
      transcricao: '[00:00] Falante 1: Onde você trabalhava?',
      geradoEm: new Date('2026-10-15T12:00:00'),
    });
    const texto = await extrairTexto(destino);
    expect(texto).toContain('Maria Souza');
    expect(texto).toContain('Qual era o endereço');
    expect(texto).toContain('Rua das Flores, 10.');
    expect(texto).toContain('Não abordado na ligação');
    expect(texto).toContain('Resposta: Não');
    expect(texto).toContain('Transcrição da ligação');
    expect(texto).toContain('Onde você trabalhava?');
    expect(await contarPaginas(destino)).toBeGreaterThanOrEqual(2);
  });

  it('a etapa grava o PDF na pasta do job e marca atenção nas perguntas sem resposta', async () => {
    const { ctx, pastaJob, mensagens } = await preparar({ transcricao: 'x' });
    writeFileSync(join(pastaJob, 'perguntas.json'), JSON.stringify(perguntasExemplo));
    writeFileSync(
      join(pastaJob, 'respostas.json'),
      JSON.stringify([
        { numero: 1, simNao: null, resposta: 'a', naoRespondida: false },
        { numero: 2, simNao: null, resposta: '', naoRespondida: true },
        { numero: 3, simNao: 'Sim', resposta: 'b', naoRespondida: false },
      ]),
    );
    const r = await etapaPdfEntrevista().executar(ctx);
    expect(r.status).toBe('ok');
    expect(existsSync(join(pastaJob, 'Entrevista preenchida.pdf'))).toBe(true);
    expect(mensagens.some((m) => /1 pergunta/.test(m))).toBe(true);
  });
});

describe('PDF real de perguntas', () => {
  it('tem 10 páginas rasterizáveis (dado de referência da Elisângela)', async () => {
    const pdf = join(PASTA_REAL, 'Perguntas entrevista .pdf');
    if (!existsSync(pdf)) return;
    expect(await contarPaginas(pdf)).toBe(10);
  });
});

describe('etapaEntregarEntrevista', () => {
  it('copia o PDF do job para Entrevista/ na pasta do cliente', async () => {
    const { etapaEntregarEntrevista } = await import('../src/main/etapas/entregar-entrevista');
    const { ctx, pastaJob, cliente } = await preparar({ transcricao: 'x' });
    writeFileSync(join(pastaJob, 'Entrevista preenchida.pdf'), '%PDF-1');
    const r = await etapaEntregarEntrevista().executar(ctx);
    expect(r.status).toBe('ok');
    expect(readFileSync(join(cliente, 'Entrevista', 'Entrevista preenchida.pdf'), 'utf8')).toBe('%PDF-1');
    // nova versão substitui e guarda a antiga
    writeFileSync(join(pastaJob, 'Entrevista preenchida.pdf'), '%PDF-2');
    await etapaEntregarEntrevista().executar(ctx);
    expect(readFileSync(join(cliente, 'Entrevista', 'Entrevista preenchida.pdf'), 'utf8')).toBe('%PDF-2');
    expect(existsSync(join(cliente, '_substituidos', 'Entrevista'))).toBe(true);
  });
});
