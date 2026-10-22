import { createServer, type Server } from 'node:http';
import { ClienteWaha, ehDocumentoOuImagem, type ArquivoWhatsapp } from '../src/main/ferramentas/waha';

interface Pedido {
  caminho: string;
  params: URLSearchParams;
  chave: string | undefined;
}

const LID = '123456789@lid';
const PN = '553197654321@c.us';

type Msg = { id: string; timestamp: number; fromMe: boolean; hasMedia: boolean; body?: string; media: null | { url: string | null; mimetype: string; filename: string | null; error: unknown } };
const midia = (arquivo: string, mimetype: string, filename: string | null = null) => ({ url: `http://localhost:3000/api/files/furtado/${arquivo}`, mimetype, filename, error: null });

/** Conversa da cliente (mais nova primeiro, como o WAHA devolve): guardada pelo LID e, em parte, pelo número. */
const CONVERSAS: Record<string, Msg[]> = {
  [LID]: [
    { id: 'm7', timestamp: 1760000700, fromMe: true, hasMedia: true, body: 'Segue a procuração', media: midia('procuracao.pdf', 'application/pdf', 'Procuração.pdf') },
    { id: 'm6', timestamp: 1760000600, fromMe: false, hasMedia: true, media: midia('expirado.jpg', 'image/jpeg') },
    { id: 'm5', timestamp: 1760000500, fromMe: false, hasMedia: true, media: midia('ctps.pdf', 'application/pdf', 'CTPS digital.pdf') },
    { id: 'm4', timestamp: 1760000400, fromMe: false, hasMedia: true, media: midia('figurinha.webp', 'image/webp') },
    { id: 'm3', timestamp: 1760000300, fromMe: false, hasMedia: true, media: null },
    { id: 'm2', timestamp: 1760000200, fromMe: false, hasMedia: false, body: 'Trabalhei na Limpa Tudo', media: null },
    { id: 'm0', timestamp: 1760000050, fromMe: true, hasMedia: false, body: 'Bom dia! Em qual empresa você trabalhou?', media: null },
    { id: 'm1', timestamp: 1760000100, fromMe: false, hasMedia: true, media: midia('rg.jpg', 'image/jpeg', 'RG frente.jpg') },
  ],
  [PN]: [
    { id: 'm8', timestamp: 1760000800, fromMe: false, hasMedia: true, media: midia('comprovante.png', 'image/png') },
    { id: 'm1', timestamp: 1760000100, fromMe: false, hasMedia: true, media: midia('rg.jpg', 'image/jpeg', 'RG frente.jpg') },
  ],
};
const ARQUIVOS: Record<string, string> = { 'rg.jpg': 'JPEG-RG', 'ctps.pdf': '%PDF-CTPS', 'figurinha.webp': 'RIFF', 'comprovante.png': 'PNG-COMP', 'novo.jpg': 'JPEG-NOVO', 'procuracao.pdf': '%PDF-P' };

function servidorFalso(status = 'WORKING') {
  const pedidos: Pedido[] = [];
  const servidor: Server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    const caminho = decodeURIComponent(url.pathname);
    const chave = req.headers['x-api-key'] as string | undefined;
    pedidos.push({ caminho, params: url.searchParams, chave });
    const json = (corpo: unknown, codigo = 200) => {
      res.writeHead(codigo, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corpo));
    };
    if (chave !== 'chave-certa') return json({ message: 'Unauthorized' }, 401);
    if (caminho === '/api/sessions/furtado') return json({ name: 'furtado', status, me: { id: '5532999990000@c.us', pushName: 'Furtado Advocacia' } });
    if (caminho === '/api/contacts/check-exists') {
      return url.searchParams.get('phone') === '5531976543210' ? json({ numberExists: true, chatId: LID, pn: PN }) : json({ numberExists: false, chatId: null });
    }
    const unica = /^\/api\/furtado\/chats\/(.+)\/messages\/(.+)$/.exec(caminho);
    if (unica) return json({ ...CONVERSAS[unica[1]].find((m) => m.id === unica[2]), media: midia('novo.jpg', 'image/jpeg') });
    const lista = /^\/api\/furtado\/chats\/(.+)\/messages$/.exec(caminho);
    if (lista) {
      const limite = Number(url.searchParams.get('limit'));
      const inicio = Number(url.searchParams.get('offset'));
      const soCliente = url.searchParams.get('filter.fromMe') === 'false';
      return json((CONVERSAS[lista[1]] ?? []).filter((m) => !soCliente || !m.fromMe).slice(inicio, inicio + limite));
    }
    const arquivo = /^\/api\/files\/furtado\/(.+)$/.exec(caminho);
    if (arquivo && ARQUIVOS[arquivo[1]]) {
      res.writeHead(200);
      return res.end(ARQUIVOS[arquivo[1]]);
    }
    json({ message: 'not found' }, 404);
  });
  return new Promise<{ url: string; servidor: Server; pedidos: Pedido[] }>((resolve) =>
    servidor.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(servidor.address() as { port: number }).port}`, servidor, pedidos })),
  );
}

const semEspera = async () => {};
const cliente = (url: string, chave = 'chave-certa') => new ClienteWaha({ url: () => url, apiKey: () => chave, sessao: () => 'furtado', porPagina: 2, esperar: semEspera });

describe('ehDocumentoOuImagem', () => {
  it('aceita foto e documento; recusa figurinha, áudio e vídeo', () => {
    expect(['image/jpeg', 'image/png', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].every(ehDocumentoOuImagem)).toBe(true);
    expect(['image/webp', 'audio/ogg; codecs=opus', 'video/mp4', '', null].some(ehDocumentoOuImagem)).toBe(false);
  });
});

describe('ClienteWaha', () => {
  it('testar mostra o número conectado; sessão sem QR escaneado e chave errada viram mensagem clara', async () => {
    const { url, servidor } = await servidorFalso();
    const sem = await servidorFalso('SCAN_QR_CODE');
    try {
      expect(await cliente(url).testar()).toBe('WhatsApp conectado: Furtado Advocacia · (32) 99999-0000.');
      await expect(cliente(sem.url).testar()).rejects.toThrow(/SCAN_QR_CODE \(falta escanear o QR code/);
      await expect(cliente(url, 'errada').testar()).rejects.toThrow(/recusou a chave/);
    } finally {
      servidor.close();
      sem.servidor.close();
    }
  });

  it('acha a conversa pelo telefone da planilha, com o LID e o número', async () => {
    const { url, servidor, pedidos } = await servidorFalso();
    try {
      expect(await cliente(url).acharConversa('(31) 97654-3210')).toEqual({ chatId: LID, ids: [LID, PN], telefone: '31976543210' });
      expect(pedidos[0].params.get('phone')).toBe('5531976543210');
      expect(await cliente(url).acharConversa('(11) 91234-5678')).toBeNull();
    } finally {
      servidor.close();
    }
  });

  it('percorre a conversa inteira e entrega só fotos e documentos do cliente, sem repetir', async () => {
    const { url, servidor, pedidos } = await servidorFalso();
    try {
      const w = cliente(url);
      const conversa = (await w.acharConversa('31976543210'))!;
      const recebidos: ArquivoWhatsapp[] = [];
      const resumo = await w.midiasDoCliente(conversa, async (a) => void recebidos.push(a));

      expect(recebidos.map((a) => [a.id, a.mimetype, a.nomeArquivo, a.conteudo.toString()])).toEqual([
        ['m6', 'image/jpeg', undefined, 'JPEG-NOVO'], // o arquivo tinha expirado: baixado de novo pela mensagem
        ['m5', 'application/pdf', 'CTPS digital.pdf', '%PDF-CTPS'],
        ['m1', 'image/jpeg', 'RG frente.jpg', 'JPEG-RG'],
        ['m8', 'image/png', undefined, 'PNG-COMP'],
      ]);
      expect(resumo).toEqual({ mensagens: 7, midias: 4, falhas: [] });
      const listagens = pedidos.filter((p) => p.caminho.endsWith('/messages'));
      expect(listagens.every((p) => p.params.get('filter.fromMe') === 'false' && p.params.get('downloadMedia') === 'true')).toBe(true);
      // 6 mensagens do cliente pelo LID em páginas de 2 (+1 vazia) e 2 pelo número (+1 vazia)
      expect(listagens.length).toBe(6);
      // a URL da mídia vinha com o endereço interno do WAHA (localhost:3000) e foi trocada pelo configurado
      expect(pedidos.filter((p) => p.caminho.startsWith('/api/files/')).map((p) => p.caminho)).toContain('/api/files/furtado/rg.jpg');
      expect(pedidos.every((p) => p.chave === 'chave-certa')).toBe(true);
    } finally {
      servidor.close();
    }
  });

  it('lê a conversa inteira em texto, do cliente e do escritório, em ordem e sem repetir', async () => {
    const { url, servidor, pedidos } = await servidorFalso();
    try {
      const w = cliente(url);
      const texto = await w.conversaEmTexto((await w.acharConversa('31976543210'))!);
      expect(texto.map((m) => [m.doEscritorio ? 'escritório' : 'cliente', m.texto])).toEqual([
        ['escritório', 'Bom dia! Em qual empresa você trabalhou?'],
        ['cliente', '[arquivo]'],
        ['cliente', 'Trabalhei na Limpa Tudo'],
        ['cliente', '[arquivo]'],
        ['cliente', '[arquivo]'],
        ['cliente', '[arquivo]'],
        ['cliente', '[arquivo]'],
        ['escritório', '[arquivo] Segue a procuração'],
        ['cliente', '[arquivo]'],
      ]);
      const listagens = pedidos.filter((p) => p.caminho.endsWith('/messages'));
      // as duas pontas da conversa, sem baixar arquivo nenhum
      expect(listagens.every((p) => p.params.get('filter.fromMe') === null && p.params.get('downloadMedia') === 'false')).toBe(true);
      expect(pedidos.some((p) => p.caminho.startsWith('/api/files/'))).toBe(false);
    } finally {
      servidor.close();
    }
  });
});
