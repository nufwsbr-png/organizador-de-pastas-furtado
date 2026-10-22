import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { partesDoAudio, testarChaveOpenRouter, transcreverOpenRouter } from '../src/main/ferramentas/openrouter';
import { ErroPausa } from '../src/main/job';

interface Recebido {
  url: string;
  autorizacao: string | undefined;
  corpo: { model?: string; language?: string; response_format?: string; input_audio?: { data: string; format: string } };
}

function servidorFalso(responder: (req: Recebido) => { status: number; corpo: unknown }): Promise<{ url: string; servidor: Server; recebidos: Recebido[] }> {
  const recebidos: Recebido[] = [];
  const servidor = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
      const r: Recebido = { url: req.url ?? '', autorizacao: req.headers.authorization, corpo: corpo ? JSON.parse(corpo) : {} };
      recebidos.push(r);
      const resposta = responder(r);
      res.writeHead(resposta.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(resposta.corpo));
    });
  });
  return new Promise((resolve) => {
    servidor.listen(0, '127.0.0.1', () => {
      const porta = (servidor.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${porta}`, servidor, recebidos });
    });
  });
}

/** WAV PCM 16 bits mono, com um bloco LIST antes do "data" (como gravam alguns programas). */
function wav(segundos: number, taxa = 16000): Buffer {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(taxa, 4);
  fmt.writeUInt32LE(taxa * 2, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const dados = Buffer.alloc(segundos * taxa * 2);
  for (let i = 0; i < dados.length; i += 2) dados.writeInt16LE(((i / 2) % 200) - 100, i);
  const bloco = (id: string, corpo: Buffer) => {
    const c = Buffer.alloc(8);
    c.write(id, 0, 'ascii');
    c.writeUInt32LE(corpo.length, 4);
    return Buffer.concat([c, corpo]);
  };
  const corpo = Buffer.concat([Buffer.from('WAVE'), bloco('fmt ', fmt), bloco('LIST', Buffer.from('INFOteste')), Buffer.alloc(1), bloco('data', dados)]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(corpo.length, 4);
  return Buffer.concat([riff, corpo]);
}

function arquivo(nome: string, dados: Buffer): string {
  const caminho = join(mkdtempSync(join(tmpdir(), 'or-')), nome);
  writeFileSync(caminho, dados);
  return caminho;
}

describe('transcreverOpenRouter', () => {
  it('manda JSON com o modelo padrão (Voxtral), o áudio em base64, português e a chave Bearer; devolve uma linha por trecho', async () => {
    const { url, servidor, recebidos } = await servidorFalso(() => ({
      status: 200,
      corpo: { text: 'Olá, bom dia. Bom dia, tudo bem?', segments: [{ start: 0, end: 1.5, text: ' Olá, bom dia.' }, { start: 2.2, end: 3, text: ' Bom dia, tudo bem?' }] },
    }));
    try {
      const texto = await transcreverOpenRouter(arquivo('Áudio da ligação.wav', wav(1)), 'chave-xyz', { baseUrl: url });
      expect(texto).toBe('[00:00] Olá, bom dia.\n[00:02] Bom dia, tudo bem?');
      const r = recebidos[0];
      expect(r.url).toBe('/audio/transcriptions');
      expect(r.autorizacao).toBe('Bearer chave-xyz');
      expect(r.corpo.model).toBe('mistralai/voxtral-mini-transcribe');
      expect(r.corpo.language).toBe('pt');
      expect(r.corpo.response_format).toBe('verbose_json');
      expect(r.corpo.input_audio?.format).toBe('wav');
      expect(Buffer.from(r.corpo.input_audio!.data, 'base64').toString('ascii', 0, 4)).toBe('RIFF');
    } finally {
      servidor.close();
    }
  });

  it('divide o WAV longo em partes válidas e soma o tempo de cada parte', async () => {
    const { url, servidor, recebidos } = await servidorFalso(() => ({ status: 200, corpo: { text: 'parte', segments: [{ start: 0.5, end: 0.9, text: 'parte' }] } }));
    try {
      const texto = await transcreverOpenRouter(arquivo('ligacao.wav', wav(3)), 'k', { baseUrl: url, maxSegundos: 1 });
      expect(recebidos).toHaveLength(3);
      expect(texto).toBe('[00:00] parte\n[00:01] parte\n[00:02] parte');
      for (const r of recebidos) {
        const parte = Buffer.from(r.corpo.input_audio!.data, 'base64');
        expect(parte.toString('ascii', 0, 4)).toBe('RIFF');
        expect(parte.readUInt32LE(4)).toBe(parte.length - 8);
        expect(parte.toString('ascii', 36, 40)).toBe('data');
        expect(parte.readUInt32LE(40)).toBe(32000);
      }
    } finally {
      servidor.close();
    }
  });

  it('respeita o limite de tamanho ao dividir e alinha o corte na amostra', () => {
    const partes = partesDoAudio('a.wav', wav(2), 10_064, 600);
    expect(partes.length).toBe(7);
    for (const p of partes) expect((p.dados.length - 44) % 2).toBe(0);
    expect(partes[1].inicio).toBeCloseTo(10_000 / 32_000);
  });

  it('modelo que recusa verbose_json passa para o texto simples e marca o começo de cada parte', async () => {
    const formatos: string[] = [];
    const { url, servidor, recebidos } = await servidorFalso((r) => {
      const formato = (r.corpo as { response_format?: string }).response_format ?? '';
      formatos.push(formato);
      return formato === 'verbose_json'
        ? { status: 400, corpo: { error: { message: 'The selected model does not support response_format "verbose_json". Use "json" instead.', code: 400 } } }
        : { status: 200, corpo: { text: 'texto da parte' } };
    });
    try {
      const texto = await transcreverOpenRouter(arquivo('ligacao.wav', wav(2)), 'k', { baseUrl: url, maxSegundos: 1, modelo: 'openai/gpt-4o-mini-transcribe' });
      expect(texto).toBe('[00:00] texto da parte\n[00:01] texto da parte');
      expect(formatos).toEqual(['verbose_json', 'json', 'json']);
      expect(recebidos[0].corpo.model).toBe('openai/gpt-4o-mini-transcribe');
    } finally {
      servidor.close();
    }
  });

  it('áudio grande que não é WAV pede outro caminho em vez de mandar', async () => {
    await expect(transcreverOpenRouter(arquivo('ligacao.mp3', Buffer.alloc(5000)), 'k', { baseUrl: 'http://127.0.0.1:1', maxBytes: 1000 })).rejects.toThrow(/ElevenLabs/);
  });

  it('401 e 402 viram ErroPausa com o motivo; resposta sem trechos usa o texto', async () => {
    const { url, servidor } = await servidorFalso((r) =>
      r.autorizacao === 'Bearer ruim'
        ? { status: 401, corpo: { error: { message: 'No auth credentials found' } } }
        : r.autorizacao === 'Bearer sem-credito'
          ? { status: 402, corpo: { error: { message: 'Insufficient credits' } } }
          : { status: 200, corpo: { text: ' só texto ' } },
    );
    try {
      const audio = arquivo('a.mp3', Buffer.from('ID3 falso'));
      await expect(transcreverOpenRouter(audio, 'ruim', { baseUrl: url })).rejects.toThrow(/inválida/);
      await expect(transcreverOpenRouter(audio, 'sem-credito', { baseUrl: url })).rejects.toBeInstanceOf(ErroPausa);
      await expect(transcreverOpenRouter(audio, 'sem-credito', { baseUrl: url })).rejects.toThrow(/créditos/);
      expect(await transcreverOpenRouter(audio, 'boa', { baseUrl: url })).toBe('só texto');
    } finally {
      servidor.close();
    }
  });
});

describe('testarChaveOpenRouter', () => {
  it('chave válida mostra o limite que resta; inválida avisa', async () => {
    const { url, servidor, recebidos } = await servidorFalso((r) =>
      r.autorizacao === 'Bearer boa' ? { status: 200, corpo: { data: { label: 'x', limit_remaining: 4.5 } } } : { status: 401, corpo: { error: { message: 'x' } } },
    );
    try {
      const ok = await testarChaveOpenRouter('boa', url);
      expect(ok.ok).toBe(true);
      expect(ok.mensagem).toContain('US$ 4.50');
      expect(recebidos[0].url).toBe('/key');
      expect((await testarChaveOpenRouter('ruim', url)).ok).toBe(false);
    } finally {
      servidor.close();
    }
  });
});
