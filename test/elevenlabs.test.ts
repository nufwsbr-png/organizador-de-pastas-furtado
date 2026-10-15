import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcreverElevenLabs, textoPorFalante, type RespostaScribe } from '../src/main/ferramentas/elevenlabs';
import { ErroPausa } from '../src/main/job';

interface Recebido {
  chave: string | undefined;
  corpo: string;
}

function servidorFalso(responder: (req: Recebido) => { status: number; corpo: unknown }): Promise<{ url: string; servidor: Server; recebidos: Recebido[] }> {
  const recebidos: Recebido[] = [];
  const servidor = createServer((req, res) => {
    let corpo = '';
    req.setEncoding('latin1');
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
      const r: Recebido = { chave: req.headers['xi-api-key'] as string | undefined, corpo };
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

const resposta: RespostaScribe = {
  language_code: 'por',
  text: 'Olá, bom dia. Bom dia, tudo bem?',
  words: [
    { text: 'Olá,', type: 'word', start: 0, end: 0.3, speaker_id: 'speaker_0' },
    { text: ' ', type: 'spacing', start: 0.3, end: 0.3, speaker_id: 'speaker_0' },
    { text: 'bom', type: 'word', start: 0.3, end: 0.5, speaker_id: 'speaker_0' },
    { text: ' ', type: 'spacing', start: 0.5, end: 0.5, speaker_id: 'speaker_0' },
    { text: 'dia.', type: 'word', start: 0.5, end: 0.8, speaker_id: 'speaker_0' },
    { text: ' ', type: 'spacing', start: 0.8, end: 0.9, speaker_id: 'speaker_0' },
    { text: 'Bom', type: 'word', start: 1.0, end: 1.2, speaker_id: 'speaker_1' },
    { text: ' ', type: 'spacing', start: 1.2, end: 1.2, speaker_id: 'speaker_1' },
    { text: 'dia,', type: 'word', start: 1.2, end: 1.4, speaker_id: 'speaker_1' },
    { text: ' ', type: 'spacing', start: 1.4, end: 1.4, speaker_id: 'speaker_1' },
    { text: 'tudo', type: 'word', start: 1.4, end: 1.6, speaker_id: 'speaker_1' },
    { text: ' ', type: 'spacing', start: 1.6, end: 1.6, speaker_id: 'speaker_1' },
    { text: 'bem?', type: 'word', start: 1.6, end: 1.9, speaker_id: 'speaker_1' },
    { text: '(riso)', type: 'audio_event', start: 2.0, end: 2.2, speaker_id: 'speaker_1' },
  ],
};

function audioFalso(): string {
  const dir = mkdtempSync(join(tmpdir(), 'el-'));
  const arquivo = join(dir, 'Áudio da ligação.wav');
  writeFileSync(arquivo, Buffer.from('RIFF....WAVEfmt '));
  return arquivo;
}

describe('textoPorFalante', () => {
  it('quebra parágrafo a cada troca de falante e marca o tempo', () => {
    const texto = textoPorFalante(resposta);
    expect(texto).toBe('[00:00] Falante 1: Olá, bom dia.\n\n[00:01] Falante 2: Bom dia, tudo bem?');
  });

  it('sem words usa o texto corrido', () => {
    expect(textoPorFalante({ text: 'só texto' })).toBe('só texto');
  });
});

describe('transcreverElevenLabs', () => {
  it('manda o arquivo em multipart com a chave e os campos do Scribe', async () => {
    const { url, servidor, recebidos } = await servidorFalso(() => ({ status: 200, corpo: resposta }));
    try {
      const texto = await transcreverElevenLabs(audioFalso(), 'chave-xyz', { baseUrl: url });
      expect(texto).toContain('Falante 1: Olá, bom dia.');
      expect(recebidos[0].chave).toBe('chave-xyz');
      const corpo = recebidos[0].corpo;
      expect(corpo).toMatch(/name="model_id"\r\n\r\nscribe_v2/);
      expect(corpo).toMatch(/name="language_code"\r\n\r\npor/);
      expect(corpo).toMatch(/name="diarize"\r\n\r\ntrue/);
      expect(corpo).toMatch(/name="file"; filename="/);
      expect(corpo).toContain('RIFF....WAVEfmt ');
    } finally {
      servidor.close();
    }
  });

  it('401 vira ErroPausa de chave inválida; 500 vira ErroPausa de serviço', async () => {
    const { url, servidor } = await servidorFalso((r) => (r.chave === 'ruim' ? { status: 401, corpo: { detail: { message: 'Invalid API key' } } } : { status: 500, corpo: {} }));
    try {
      await expect(transcreverElevenLabs(audioFalso(), 'ruim', { baseUrl: url })).rejects.toThrow(/chave.*inválida/i);
      await expect(transcreverElevenLabs(audioFalso(), 'ok', { baseUrl: url })).rejects.toBeInstanceOf(ErroPausa);
    } finally {
      servidor.close();
    }
  });
});
