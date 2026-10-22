import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { etapaClassificar } from '../src/main/etapas/classificar';
import { inventariar, type Inventario } from '../src/main/etapas/inventario';
import { etapaMover } from '../src/main/etapas/mover';
import { ARQUIVO_CONVERSA, conversaParaTexto, etapaWhatsapp, MENSAGEM_SEM_WAHA, nomeDoArquivo } from '../src/main/etapas/whatsapp';
import { Fila } from '../src/main/fila';
import type { ArquivoWhatsapp, FonteWhatsapp, MensagemTexto } from '../src/main/ferramentas/waha';
import type { Contexto } from '../src/main/job';
import type { Pedido, Provedor } from '../src/main/provedores/tipos';

const png = (tom: number) => {
  const c = createCanvas(60, 40);
  const g = c.getContext('2d');
  g.fillStyle = `rgb(${tom},${tom},${tom})`;
  g.fillRect(0, 0, 60, 40);
  return c.toBuffer('image/png');
};
/** 06/10/2026 14:10 em Brasília. */
const QUANDO = Date.UTC(2026, 9, 6, 17, 10) / 1000;

function arquivo(id: string, minutos: number, mimetype: string, conteudo: Buffer, nomeArquivo?: string): ArquivoWhatsapp {
  return { id, quando: QUANDO + minutos * 60, mimetype, conteudo, nomeArquivo };
}

/** Conversa em texto: a cliente cita duas empresas; a que serve é a segunda. */
const TEXTO: MensagemTexto[] = [
  { quando: QUANDO, doEscritorio: false, texto: 'Oi, trabalhei na Padaria Pão Quente até 2020' },
  { quando: QUANDO + 60, doEscritorio: true, texto: 'E depois disso?' },
  { quando: QUANDO + 120, doEscritorio: false, texto: 'Fiquei 2 anos na Limpa Tudo Serviços,\nsaí em junho' },
  { quando: QUANDO + 180, doEscritorio: false, texto: '[arquivo] minha carteira' },
];

function whatsappFalso(arquivos: ArquivoWhatsapp[], conversa = true): FonteWhatsapp & { pedidos: string[] } {
  const pedidos: string[] = [];
  return {
    pedidos,
    conversaEmTexto: async () => {
      pedidos.push('texto');
      return TEXTO;
    },
    acharConversa: async (tel) => {
      pedidos.push(`conversa:${tel}`);
      return conversa ? { chatId: '1@lid', ids: ['1@lid'], telefone: tel } : null;
    },
    midiasDoCliente: async (_c, aoArquivo) => {
      for (const a of arquivos) await aoArquivo(a);
      return { mensagens: 12, midias: arquivos.length, falhas: [{ id: 'x', quando: QUANDO, motivo: 'o WhatsApp não entregou mais esse arquivo' }] };
    },
  };
}

/** Pasta como chega: só a entrevista e a transcrição (e, às vezes, algum documento). */
function pastaDaEntrevista(extras: Record<string, Buffer | string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wpp-'));
  const pasta = join(dir, 'Lúcia Helena Araújo');
  const pastaJob = join(dir, 'job');
  mkdirSync(join(pasta, 'Entrevista'), { recursive: true });
  mkdirSync(pastaJob);
  writeFileSync(join(pasta, 'Entrevista', 'Perguntas entrevista.pdf'), '%PDF-perguntas');
  writeFileSync(join(pasta, 'Entrevista', 'Transcrição.txt'), 'Atendente: bom dia');
  for (const [rel, conteudo] of Object.entries(extras)) {
    mkdirSync(join(pasta, rel, '..'), { recursive: true });
    writeFileSync(join(pasta, rel), conteudo);
  }
  writeFileSync(join(pastaJob, 'cliente.json'), JSON.stringify({ nome: 'Lúcia Helena Araújo', telefone: '31976543210', linha: 195, confirmadoPor: 'zapsign' }));
  inventariar(pasta, join(pastaJob, 'inventario.json'));
  const fila = new Fila(join(dir, 'jobs.json'));
  const job = fila.adicionar(pasta);
  const mensagens: { texto: string; nivel?: string }[] = [];
  const ctx: Contexto = { fila, pastaJob, job, log: (texto, nivel) => void mensagens.push({ texto, nivel }) };
  return { pasta, pastaJob, ctx, mensagens };
}

const listar = (dir: string, prefixo = ''): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listar(join(dir, e.name), `${prefixo}${e.name}/`) : [`${prefixo}${e.name}`])).sort();

describe('nomeDoArquivo', () => {
  it('data e hora de Brasília + nome original; sem nome, "foto" ou "documento"', () => {
    expect(nomeDoArquivo(arquivo('a', 0, 'image/jpeg', Buffer.from(''), 'RG frente.jpg'))).toBe('2026-10-06 14.10 - RG frente.jpg');
    expect(nomeDoArquivo(arquivo('b', 5, 'image/jpeg', Buffer.from('')))).toBe('2026-10-06 14.15 - foto.jpg');
    expect(nomeDoArquivo(arquivo('c', 0, 'application/pdf', Buffer.from(''), 'CTPS: digital?.PDF'))).toBe('2026-10-06 14.10 - CTPS digital.pdf');
    expect(nomeDoArquivo(arquivo('d', 0, 'application/pdf', Buffer.from('')))).toBe('2026-10-06 14.10 - documento.pdf');
  });
});

describe('etapaWhatsapp', () => {
  it('baixa o que o cliente mandou para WhatsApp/, sem repetir nem trazer o que já está na pasta', async () => {
    const jaNaPasta = Buffer.from('%PDF-comprovante-que-ja-veio');
    const { pasta, pastaJob, ctx, mensagens } = pastaDaEntrevista({ 'Scan/conta de luz.pdf': jaNaPasta });
    const w = whatsappFalso([
      arquivo('m1', 0, 'image/png', png(10), 'RG frente.png'),
      arquivo('m2', 1, 'image/png', png(200), 'RG verso.png'),
      arquivo('m3', 2, 'image/png', png(10), 'RG frente de novo.png'), // mesma foto mandada duas vezes
      arquivo('m4', 3, 'application/pdf', Buffer.from('%PDF-ctps'), 'CTPS digital.pdf'),
      arquivo('m5', 4, 'application/pdf', jaNaPasta, 'conta.pdf'),
    ]);
    expect(await etapaWhatsapp(() => w).executar(ctx)).toEqual({ status: 'ok' });
    expect(w.pedidos).toEqual(['conversa:31976543210', 'texto']);
    expect(readFileSync(join(pastaJob, ARQUIVO_CONVERSA), 'utf8')).toContain('Cliente: Fiquei 2 anos na Limpa Tudo Serviços, / saí em junho');
    expect(listar(join(pasta, 'WhatsApp'))).toEqual(['2026-10-06 14.10 - RG frente.png', '2026-10-06 14.11 - RG verso.png', '2026-10-06 14.13 - CTPS digital.pdf']);
    expect(mensagens.map((m) => m.texto)).toContain('WhatsApp: li 12 mensagem(ns) do cliente e salvei 3 documento(s) ou imagem(ns) em WhatsApp/ (2 repetido(s) ignorado(s)).');
    expect(mensagens.some((m) => m.nivel === 'aviso' && m.texto.includes('não entregou mais esse arquivo'))).toBe(true);
    // o inventário já vê os arquivos novos para a classificação
    const inv = JSON.parse(readFileSync(join(pastaJob, 'inventario.json'), 'utf8')) as Inventario;
    expect(inv.arquivos.filter((a) => a.relativo.startsWith('WhatsApp/')).every((a) => a.situacao === 'classificar')).toBe(true);
  });

  it('pasta que já tem RG, CTPS e comprovante: só lê a conversa (para confirmar a empresa), sem baixar nada', async () => {
    const docs = { 'Documentos/RG.pdf': '%PDF', 'Documentos/CTPS.pdf': '%PDF', 'Não juntar/Comprovante de residência.pdf': '%PDF' };
    const { pasta, pastaJob, ctx } = pastaDaEntrevista(docs);
    const w = whatsappFalso([arquivo('m1', 0, 'image/png', png(10), 'RG frente.png')]);
    expect(await etapaWhatsapp(() => w).executar(ctx)).toEqual({ status: 'ok' });
    expect(w.pedidos).toEqual(['conversa:31976543210', 'texto']);
    expect(existsSync(join(pasta, 'WhatsApp'))).toBe(false);
    expect(existsSync(join(pastaJob, ARQUIVO_CONVERSA))).toBe(true);
    // sem WAHA ou sem a conversa, com os documentos na pasta, segue sem travar
    expect((await etapaWhatsapp(() => null).executar(pastaDaEntrevista(docs).ctx)).status).toBe('pulada');
    expect((await etapaWhatsapp(() => whatsappFalso([], false)).executar(pastaDaEntrevista(docs).ctx)).status).toBe('pulada');
  });

  it('a conversa em texto tem data e hora de Brasília e quem mandou, uma linha por mensagem', () => {
    expect(conversaParaTexto(TEXTO).split('\n')).toEqual([
      '[06/10/2026 14:10] Cliente: Oi, trabalhei na Padaria Pão Quente até 2020',
      '[06/10/2026 14:11] Escritório: E depois disso?',
      '[06/10/2026 14:12] Cliente: Fiquei 2 anos na Limpa Tudo Serviços, / saí em junho',
      '[06/10/2026 14:13] Cliente: [arquivo] minha carteira',
    ]);
  });

  it('sem WAHA ou sem conversa com o número: pendente explicando', async () => {
    const { ctx } = pastaDaEntrevista();
    expect(await etapaWhatsapp(() => null).executar(ctx)).toEqual({ status: 'pendente', motivo: MENSAGEM_SEM_WAHA });
    const r = await etapaWhatsapp(() => whatsappFalso([], false)).executar(ctx);
    expect(r.status === 'pendente' && r.motivo).toBe('Não achei conversa com (31) 97654-3210 no WhatsApp do escritório. Confira o telefone na planilha ou informe outro abaixo.');
  });
});

/** IA falsa: classifica pelo nome do arquivo que aparece no pedido. */
function provedorPorNome(pedidos: Pedido[] = []): Provedor {
  return {
    id: 'claude',
    nome: 'Falso',
    status: async () => ({ instalado: true, logado: true, conta: 'x', caminho: 'x' }),
    rodar: async (p) => {
      pedidos.push(p);
      const itens = [...p.prompt.matchAll(/\[id: (\d+)\] (.+)/g)].map((m) => ({ id: Number(m[1]), nome: m[2] }));
      return {
        arquivos: itens.map(({ id, nome }) => {
          if (/RG frente/.test(nome)) return { id, tipo: 'RG', grupo: 'rg', ordem: 1 };
          if (/RG verso/.test(nome)) return { id, tipo: 'RG', grupo: 'rg', ordem: 2 };
          if (/CTPS/.test(nome)) return { id, tipo: 'CTPS', grupo: null, ordem: 1 };
          return { id, tipo: 'outro', grupo: null, ordem: 1 };
        }),
      };
    },
  };
}

describe('WhatsApp → classificação → arrumação', () => {
  it('RG de frente e verso vira RG.pdf, CTPS vai para Documentos e o resto do WhatsApp vai para Não juntar', async () => {
    const { pasta, pastaJob, ctx } = pastaDaEntrevista({ 'Scan/rascunho.pdf': '%PDF-rascunho-da-pasta' });
    const w = whatsappFalso([
      arquivo('m1', 0, 'image/png', png(10), 'RG frente.png'),
      arquivo('m2', 1, 'image/png', png(200), 'RG verso.png'),
      arquivo('m3', 3, 'application/pdf', Buffer.from('%PDF-ctps'), 'CTPS digital.pdf'),
      arquivo('m4', 4, 'application/pdf', Buffer.from('%PDF-laudo'), 'laudo médico.pdf'),
      arquivo('m5', 5, 'image/png', png(90)),
    ]);
    await etapaWhatsapp(() => w).executar(ctx);
    expect(await etapaClassificar(() => provedorPorNome()).executar(ctx)).toEqual({ status: 'ok' });
    expect(await etapaMover().executar(ctx)).toEqual({ status: 'ok' });

    const arvore = listar(pasta).filter((r) => !r.startsWith('_substituidos/'));
    expect(arvore).toEqual([
      'Documentos/CTPS.pdf',
      'Documentos/RG.pdf',
      'Entrevista/Perguntas entrevista.pdf',
      'Entrevista/Transcrição.txt',
      'Não juntar/2026-10-06 14.14 - laudo médico.pdf',
      'Não juntar/2026-10-06 14.15 - foto.png',
      'Revisar/rascunho.pdf', // o que já estava na pasta e não serve continua indo para Revisar
    ]);
    expect(readFileSync(join(pasta, 'Documentos', 'RG.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
    expect(existsSync(join(pasta, 'WhatsApp'))).toBe(false);
    // as fotos originais do RG ficam guardadas, nunca apagadas
    expect(listar(join(pasta, '_substituidos'))).toEqual(['WhatsApp/2026-10-06 14.10 - RG frente.png', 'WhatsApp/2026-10-06 14.11 - RG verso.png']);
    expect(existsSync(join(pastaJob, 'movimentos.json'))).toBe(true);
  });

  it('conversa com muitos arquivos: a IA classifica em lotes de até 20', async () => {
    const { pasta, ctx } = pastaDaEntrevista();
    const w = whatsappFalso(Array.from({ length: 25 }, (_, n) => arquivo(`m${n}`, n, 'text/plain', Buffer.from(`print ${n}`), `print ${String(n).padStart(2, '0')}.txt`)));
    await etapaWhatsapp(() => w).executar(ctx);
    const pedidos: Pedido[] = [];
    await etapaClassificar(() => provedorPorNome(pedidos)).executar(ctx);
    expect(pedidos.map((p) => p.nomeTarefa)).toEqual(['classificar (lote 1)', 'classificar (lote 2)']);
    expect(pedidos.map((p) => [...p.prompt.matchAll(/\[id: /g)].length)).toEqual([20, 5]);
    await etapaMover().executar(ctx);
    expect(listar(join(pasta, 'Não juntar'))).toHaveLength(25);
  });
});
