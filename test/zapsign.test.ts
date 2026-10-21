import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClienteZapsign, ErroZapsign, type EnvelopeDetalhe, type EnvelopeIndice, type FonteZapsign } from '../src/main/ferramentas/zapsign';
import { grauNome } from '../src/main/ferramentas/nomes';
import { etapaZapsign, interpretarBusca, MENSAGEM_SEM_TOKEN, tipoDoAssinado } from '../src/main/etapas/zapsign';
import { inventariar, type Inventario } from '../src/main/etapas/inventario';
import { Fila } from '../src/main/fila';
import type { Contexto } from '../src/main/job';

interface Pedido {
  caminho: string;
  params: URLSearchParams;
  auth: string | undefined;
}

function servidorFalso(responder: (p: Pedido) => { status: number; corpo: unknown; headers?: Record<string, string> }) {
  const pedidos: Pedido[] = [];
  const servidor: Server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    const p = { caminho: url.pathname, params: url.searchParams, auth: req.headers.authorization };
    pedidos.push(p);
    const r = responder(p);
    res.writeHead(r.status, { 'content-type': 'application/json', ...r.headers });
    res.end(JSON.stringify(r.corpo));
  });
  return new Promise<{ url: string; servidor: Server; pedidos: Pedido[] }>((resolve) =>
    servidor.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(servidor.address() as { port: number }).port}`, servidor, pedidos })),
  );
}

/** Listagem como a da API: o principal com signatário (campos em português), os anexos sem. */
function listagem(total: number): unknown[] {
  const docs: unknown[] = [];
  for (let i = 0; i < total; i++) {
    const criado = new Date(Date.now() - i * 3_600_000).toISOString();
    docs.push({ token: `env-${i}`, name: 'Declaração de pobreza.docx', status: 'signed', created_at: criado, signers: [{ nome: `Cliente Código ${String(i).padStart(3, '0')}`, status: 'assinou' }] });
    docs.push({ token: `anexo-${i}`, name: 'Procuração Trabalhista Furtado.docx', status: 'signed', created_at: criado, signers: [] });
  }
  return docs;
}

function paginar(docs: unknown[], params: URLSearchParams, porPagina = 25) {
  const page = Number(params.get('page') ?? 1);
  const results = docs.slice((page - 1) * porPagina, page * porPagina);
  return { count: docs.length, next: page * porPagina < docs.length ? 'mais' : null, previous: null, results };
}

const semEspera = async () => {};

describe('grauNome', () => {
  it('mesmo nome com ou sem acento e caixa é igual', () => {
    expect(grauNome('Lúcia Helena Araújo', 'LUCIA HELENA ARAUJO')).toBe('igual');
  });
  it('nome da pasta mais curto ou com sobra ainda é parecido', () => {
    expect(grauNome('Lúcia Araújo', 'Lúcia Helena Araújo')).toBe('parecido');
    expect(grauNome('Lúcia Helena Araújo - Acme', 'Lúcia Helena Araújo')).toBe('parecido');
  });
  it('um só nome em comum não basta', () => {
    expect(grauNome('Maria', 'Maria Souza')).toBeNull();
    expect(grauNome('João da Silva', 'João Pereira')).toBeNull();
  });
});

describe('tipoDoAssinado e interpretarBusca', () => {
  it('reconhece os documentos do envelope pelo nome', () => {
    expect(tipoDoAssinado('Procuração Trabalhista Furtado.docx')).toBe('Procuração');
    expect(tipoDoAssinado('Declaração de pobreza.docx')).toBe('Declaração');
    expect(tipoDoAssinado('Declaração de Hipossuficiência.pdf')).toBe('Declaração');
    expect(tipoDoAssinado('Contrato Trabalhista Furtado.docx')).toBe('Contrato Trabalhista');
    expect(tipoDoAssinado('Termo de acordo.pdf')).toBeNull();
  });
  it('entende link, e-mail ou nome', () => {
    expect(interpretarBusca('https://app.zapsign.com.br/verificar/1F2E3D4C-5B6A-4789-9abc-def012345678')).toEqual({ tipo: 'token', valor: '1f2e3d4c-5b6a-4789-9abc-def012345678' });
    expect(interpretarBusca(' cliente@gmail.com ')).toEqual({ tipo: 'email', valor: 'cliente@gmail.com' });
    expect(interpretarBusca('Lúcia Araújo')).toEqual({ tipo: 'nome', valor: 'Lúcia Araújo' });
  });
});

describe('ClienteZapsign', () => {
  it('monta o índice lendo todas as páginas (só os envelopes) e acha o cliente pelo nome', async () => {
    const docs = listagem(40); // 80 documentos = 4 páginas
    const { url, servidor, pedidos } = await servidorFalso((p) => ({ status: 200, corpo: paginar(docs, p.params) }));
    const indice = join(mkdtempSync(join(tmpdir(), 'zs-')), 'indice.json');
    const z = new ClienteZapsign({ token: () => 'tok', arquivoIndice: indice, base: url, esperar: semEspera });
    try {
      const r = await z.buscarPorNome('cliente código 007');
      expect(r.envelopes.map((e) => e.token)).toEqual(['env-7']);
      expect(pedidos).toHaveLength(4);
      expect(
        pedidos.every(
          (p) => p.auth === 'Bearer tok' && p.params.get('include_signers') === 'true' && p.params.get('deleted') === 'false' && p.params.get('created_from') && p.params.get('created_to'),
        ),
      ).toBe(true);
      const salvo = JSON.parse(readFileSync(indice, 'utf8'));
      expect(salvo.envelopes).toHaveLength(40);

      // logo em seguida, outra pasta procurando: usa o índice sem chamar a API
      await z.buscarPorNome('Cliente Código 012');
      expect(pedidos).toHaveLength(4);
    } finally {
      servidor.close();
    }
  });

  it('guarda o telefone do signatário (serve para confirmar o cliente) e remonta um índice da versão antiga', async () => {
    const docs = [{ token: 'env-1', name: 'Declaração de pobreza.docx', status: 'signed', created_at: new Date().toISOString(), signers: [{ nome: 'Lúcia Helena Araújo', status: 'assinou', telefone: '+55 31976543210' }] }];
    const { url, servidor, pedidos } = await servidorFalso((p) => ({ status: 200, corpo: paginar(docs, p.params) }));
    const arquivo = join(mkdtempSync(join(tmpdir(), 'zs-')), 'i.json');
    // índice da versão 1 (sem telefone), já sincronizado: precisa ser remontado
    writeFileSync(arquivo, JSON.stringify({ versao: 1, desde: '2020-01-01', sincronizadoEm: new Date().toISOString(), envelopes: [] }));
    const z = new ClienteZapsign({ token: () => 'tok', arquivoIndice: arquivo, base: url, esperar: semEspera });
    try {
      const r = await z.buscarPorNome('Lúcia Helena Araújo');
      expect(pedidos).toHaveLength(1);
      expect(r.envelopes[0].signatarios[0]).toEqual({ nome: 'Lúcia Helena Araújo', status: 'assinou', telefone: '+55 31976543210' });
      expect(JSON.parse(readFileSync(arquivo, 'utf8')).versao).toBe(2);
    } finally {
      servidor.close();
    }
  });

  it('várias buscas ao mesmo tempo dividem uma sincronização só', async () => {
    const docs = listagem(10);
    const { url, servidor, pedidos } = await servidorFalso((p) => ({ status: 200, corpo: paginar(docs, p.params) }));
    const z = new ClienteZapsign({ token: () => 'tok', arquivoIndice: join(mkdtempSync(join(tmpdir(), 'zs-')), 'i.json'), base: url, esperar: semEspera });
    try {
      await Promise.all([z.buscarPorNome('Cliente Código 001'), z.buscarPorNome('Cliente Código 002'), z.buscarPorNome('Cliente Código 003')]);
      expect(pedidos).toHaveLength(1);
    } finally {
      servidor.close();
    }
  });

  it('depois da primeira vez só busca o que entrou (sincronização incremental)', async () => {
    let docs = listagem(30);
    const { url, servidor, pedidos } = await servidorFalso((p) => ({ status: 200, corpo: paginar(docs, p.params) }));
    const arquivo = join(mkdtempSync(join(tmpdir(), 'zs-')), 'i.json');
    const z = new ClienteZapsign({ token: () => 'tok', arquivoIndice: arquivo, base: url, frescorMs: 0, esperar: semEspera });
    try {
      await z.sincronizar();
      const primeira = pedidos[0].params.get('created_from')!;
      docs = [{ token: 'env-novo', name: 'Declaração de pobreza.docx', status: 'pending', created_at: new Date().toISOString(), signers: [{ nome: 'Cliente Novo Silva', status: 'pendente' }] }, ...docs];
      await z.sincronizar();
      const segunda = pedidos[pedidos.length - 1].params.get('created_from')!;
      expect(segunda > primeira).toBe(true);
      expect((await z.buscarPorNome('Cliente Novo Silva')).envelopes.map((e) => e.token)).toEqual(['env-novo']);
      // um app novo lendo o mesmo arquivo de índice já acha os antigos
      const outro = new ClienteZapsign({ token: () => 'tok', arquivoIndice: arquivo, base: url, esperar: semEspera });
      expect((await outro.buscarPorNome('Cliente Código 020')).envelopes).toHaveLength(1);
    } finally {
      servidor.close();
    }
  });

  it('token recusado vira mensagem clara; 429 é tentado de novo', async () => {
    let chamadas = 0;
    const { url, servidor } = await servidorFalso((p) => {
      if (p.auth !== 'Bearer bom') return { status: 401, corpo: { detail: 'Invalid token' } };
      chamadas++;
      return chamadas === 1 ? { status: 429, corpo: {}, headers: { 'retry-after': '1' } } : { status: 200, corpo: paginar(listagem(1), p.params) };
    });
    const indice = join(mkdtempSync(join(tmpdir(), 'zs-')), 'i.json');
    try {
      const ruim = new ClienteZapsign({ token: () => 'ruim', arquivoIndice: indice, base: url, esperar: semEspera });
      await expect(ruim.testar()).rejects.toThrow(/recusou o token/);
      await expect(ruim.testar()).rejects.toBeInstanceOf(ErroZapsign);
      const bom = new ClienteZapsign({ token: () => 'bom', arquivoIndice: indice, base: url, esperar: semEspera });
      expect(await bom.testar()).toMatch(/2 documento/);
      expect(chamadas).toBe(2);
    } finally {
      servidor.close();
    }
  });

  it('detalhar junta o documento principal e os anexos', async () => {
    const { url, servidor } = await servidorFalso(() => ({
      status: 200,
      corpo: {
        token: 'env-1',
        name: 'Declaração de pobreza.docx',
        status: 'signed',
        created_at: '2026-10-06T14:10:42Z',
        signed_file: 'https://s3/decl.pdf',
        signers: [{ name: 'Lúcia Helena Araújo', status: 'signed', signed_at: '2026-10-06T14:14:07Z' }],
        extra_docs: [
          { name: 'Contrato Trabalhista Furtado.docx', signed_file: 'https://s3/contrato.pdf' },
          { name: 'Procuração Trabalhista Furtado.docx', signed_file: 'https://s3/proc.pdf' },
        ],
      },
    }));
    const z = new ClienteZapsign({ token: () => 'tok', arquivoIndice: join(mkdtempSync(join(tmpdir(), 'zs-')), 'i.json'), base: url, esperar: semEspera });
    try {
      const d = await z.detalhar('env-1');
      expect(d.signatarios[0]).toEqual({ nome: 'Lúcia Helena Araújo', status: 'signed', assinadoEm: '2026-10-06T14:14:07Z' });
      expect(d.documentos.map((x) => x.nome)).toEqual(['Declaração de pobreza.docx', 'Contrato Trabalhista Furtado.docx', 'Procuração Trabalhista Furtado.docx']);
      expect(d.documentos[2].arquivoAssinado).toBe('https://s3/proc.pdf');
    } finally {
      servidor.close();
    }
  });
});

/** ZapSign falso: envelopes no índice, detalhes por token e PDFs por URL. */
function fonteFalsa(envelopes: EnvelopeIndice[], detalhes: Record<string, EnvelopeDetalhe>, registro: string[] = []): FonteZapsign {
  return {
    async buscarPorNome(nome) {
      registro.push(`nome:${nome}`);
      return { envelopes: envelopes.filter((e) => e.signatarios.some((s) => grauNome(nome, s.nome))), desde: '2026-07-01' };
    },
    async buscarPorEmail(email) {
      registro.push(`email:${email}`);
      return envelopes.slice(0, 1);
    },
    async detalhar(token) {
      registro.push(`detalhar:${token}`);
      return detalhes[token];
    },
    async baixar(url) {
      registro.push(`baixar:${url}`);
      return Buffer.from(`%PDF-1.7 ${url}`);
    },
  };
}

function envelope(token: string, cliente: string, criadoEm: string, status = 'signed'): { indice: EnvelopeIndice; detalhe: EnvelopeDetalhe } {
  return {
    indice: { token, nome: 'Declaração de pobreza.docx', status, criadoEm, signatarios: [{ nome: cliente, status: 'assinou' }] },
    detalhe: {
      token,
      nome: 'Declaração de pobreza.docx',
      status,
      criadoEm,
      signatarios: [{ nome: cliente, status: 'signed', assinadoEm: criadoEm }],
      documentos: [
        { nome: 'Declaração de pobreza.docx', arquivoAssinado: status === 'signed' ? `${token}/declaracao` : null },
        { nome: 'Contrato Trabalhista Furtado.docx', arquivoAssinado: status === 'signed' ? `${token}/contrato` : null },
        { nome: 'Procuração Trabalhista Furtado.docx', arquivoAssinado: status === 'signed' ? `${token}/procuracao` : null },
      ],
    },
  };
}

/** Pasta como chega no escritório: sem os documentos assinados. */
function pastaSemAssinados(nome = 'Lúcia Helena Araújo', extras: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zsp-'));
  const cliente = join(dir, nome);
  const pastaJob = join(dir, 'job');
  mkdirSync(join(cliente, 'Documentos'), { recursive: true });
  mkdirSync(pastaJob);
  writeFileSync(join(cliente, 'Documentos', 'RG.pdf'), '%PDF-rg');
  writeFileSync(join(cliente, 'ligacao.wav'), 'RIFF');
  for (const [rel, conteudo] of Object.entries(extras)) {
    mkdirSync(join(cliente, rel, '..'), { recursive: true });
    writeFileSync(join(cliente, rel), conteudo);
  }
  inventariar(cliente, join(pastaJob, 'inventario.json'));
  const fila = new Fila(join(dir, 'jobs.json'));
  const job = fila.adicionar(cliente);
  const mensagens: string[] = [];
  const ctx = (buscaZapsign?: string): Contexto => ({ fila, pastaJob, job: { ...job, buscaZapsign }, log: (t) => void mensagens.push(t) });
  return { cliente, pastaJob, ctx, mensagens };
}

describe('etapaZapsign', () => {
  it('baixa procuração, declaração e contrato assinados e grava no padrão', async () => {
    const e = envelope('env-1', 'LUCIA HELENA ARAUJO', '2026-10-06T14:10:42Z');
    const registro: string[] = [];
    const { cliente, pastaJob, ctx, mensagens } = pastaSemAssinados();
    const r = await etapaZapsign(() => fonteFalsa([e.indice], { 'env-1': e.detalhe }, registro)).executar(ctx());

    expect(r).toEqual({ status: 'ok' });
    expect(readFileSync(join(cliente, 'Contratos', 'Procuração.pdf'), 'utf8')).toBe('%PDF-1.7 env-1/procuracao');
    expect(readFileSync(join(cliente, 'Contratos', 'Declaração.pdf'), 'utf8')).toBe('%PDF-1.7 env-1/declaracao');
    expect(readFileSync(join(cliente, 'Não juntar', 'Contrato Trabalhista.pdf'), 'utf8')).toBe('%PDF-1.7 env-1/contrato');
    expect(registro[0]).toBe('nome:Lúcia Helena Araújo');
    // o inventário foi refeito: a classificação já vê os assinados no lugar
    const inv = JSON.parse(readFileSync(join(pastaJob, 'inventario.json'), 'utf8')) as Inventario;
    expect(inv.arquivos.filter((a) => a.situacao === 'no-lugar').map((a) => a.relativo).sort()).toEqual(
      ['Contratos/Declaração.pdf', 'Contratos/Procuração.pdf', 'Documentos/RG.pdf', 'Não juntar/Contrato Trabalhista.pdf'].sort(),
    );
    expect(existsSync(join(pastaJob, 'zapsign.json'))).toBe(true);
    expect(mensagens.some((m) => m.includes('Procuração Trabalhista Furtado.docx → Contratos/Procuração.pdf'))).toBe(true);
  });

  it('pasta que já tem os três assinados não chama o ZapSign', async () => {
    const { ctx } = pastaSemAssinados('Fulano de Tal', {
      'Contratos/Procuração.pdf': '%PDF',
      'Contratos/Declaração.pdf': '%PDF',
      'Não juntar/Contrato Trabalhista.pdf': '%PDF',
    });
    const registro: string[] = [];
    const r = await etapaZapsign(() => fonteFalsa([], {}, registro)).executar(ctx());
    expect(r.status).toBe('pulada');
    expect(registro).toEqual([]);
  });

  it('só baixa o que falta', async () => {
    const e = envelope('env-1', 'Fulano de Tal', '2026-10-06T14:10:42Z');
    const { cliente, ctx } = pastaSemAssinados('Fulano de Tal', { 'Contratos/Procuração.pdf': '%PDF-original' });
    const registro: string[] = [];
    expect(await etapaZapsign(() => fonteFalsa([e.indice], { 'env-1': e.detalhe }, registro)).executar(ctx())).toEqual({ status: 'ok' });
    expect(readFileSync(join(cliente, 'Contratos', 'Procuração.pdf'), 'utf8')).toBe('%PDF-original');
    expect(registro.filter((r) => r.startsWith('baixar:'))).toEqual(['baixar:env-1/declaracao', 'baixar:env-1/contrato']);
  });

  it('sem token fica pendente pedindo o token', async () => {
    const { ctx } = pastaSemAssinados();
    expect(await etapaZapsign(() => null).executar(ctx())).toEqual({ status: 'pendente', motivo: MENSAGEM_SEM_TOKEN });
  });

  it('cliente que não está no ZapSign fica pendente explicando o que fazer', async () => {
    const e = envelope('env-1', 'Outra Pessoa Qualquer', '2026-10-06T14:10:42Z');
    const { ctx, cliente } = pastaSemAssinados();
    const r = await etapaZapsign(() => fonteFalsa([e.indice], { 'env-1': e.detalhe })).executar(ctx());
    expect(r.status).toBe('pendente');
    expect(r.status === 'pendente' && r.motivo).toMatch(/Não achei no ZapSign.*Lúcia Helena Araújo/);
    expect(existsSync(join(cliente, 'Contratos'))).toBe(false);
  });

  it('envelope ainda não assinado fica pendente', async () => {
    const e = envelope('env-1', 'Lúcia Helena Araújo', '2026-10-06T14:10:42Z', 'pending');
    const { ctx } = pastaSemAssinados();
    const r = await etapaZapsign(() => fonteFalsa([e.indice], { 'env-1': e.detalhe })).executar(ctx());
    expect(r.status === 'pendente' && r.motivo).toMatch(/ainda não foi assinado/);
  });

  it('usa o envelope assinado mais novo quando há mais de um', async () => {
    const velho = envelope('env-velho', 'Lúcia Helena Araújo', '2026-09-01T10:00:00Z');
    const novo = envelope('env-novo', 'Lúcia Helena Araújo', '2026-10-06T10:00:00Z');
    const { cliente, ctx } = pastaSemAssinados();
    await etapaZapsign(() => fonteFalsa([velho.indice, novo.indice], { 'env-velho': velho.detalhe, 'env-novo': novo.detalhe })).executar(ctx());
    expect(readFileSync(join(cliente, 'Contratos', 'Procuração.pdf'), 'utf8')).toContain('env-novo');
  });

  it('dois clientes diferentes parecidos com o nome da pasta: pede para informar qual', async () => {
    const a = envelope('env-a', 'Maria Souza Lima', '2026-10-06T10:00:00Z');
    const b = envelope('env-b', 'Maria Souza Prado', '2026-10-05T10:00:00Z');
    const { ctx } = pastaSemAssinados('Maria Souza');
    const r = await etapaZapsign(() => fonteFalsa([a.indice, b.indice], { 'env-a': a.detalhe, 'env-b': b.detalhe })).executar(ctx());
    expect(r.status === 'pendente' && r.motivo).toMatch(/mais de um cliente.*Maria Souza Lima.*Maria Souza Prado/);
  });

  it('com o e-mail ou o link informado pelo usuário, busca por ele em vez do nome da pasta', async () => {
    const e = envelope('1f2e3d4c-5b6a-4789-9abc-def012345678', 'Nome Diferente Da Pasta', '2026-10-06T10:00:00Z');
    const detalhes = { [e.indice.token]: e.detalhe };
    const porEmail: string[] = [];
    const { ctx } = pastaSemAssinados();
    expect(await etapaZapsign(() => fonteFalsa([e.indice], detalhes, porEmail)).executar(ctx('cliente@gmail.com'))).toEqual({ status: 'ok' });
    expect(porEmail[0]).toBe('email:cliente@gmail.com');

    const porLink: string[] = [];
    const outra = pastaSemAssinados();
    const link = `https://app.zapsign.com.br/verificar/${e.indice.token}`;
    expect(await etapaZapsign(() => fonteFalsa([e.indice], detalhes, porLink)).executar(outra.ctx(link))).toEqual({ status: 'ok' });
    expect(porLink[0]).toBe(`detalhar:${e.indice.token}`);
  });

  it('erro da API não derruba o job: fica pendente com o motivo', async () => {
    const { ctx } = pastaSemAssinados();
    const fonte: FonteZapsign = { ...fonteFalsa([], {}), buscarPorNome: async () => Promise.reject(new ErroZapsign('O ZapSign recusou o token da API (HTTP 401).')) };
    const r = await etapaZapsign(() => fonte).executar(ctx());
    expect(r).toEqual({ status: 'pendente', motivo: 'ZapSign: O ZapSign recusou o token da API (HTTP 401).' });
  });
});
