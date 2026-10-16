import { classificarCaminho, PASTAS_PADRAO, DOCUMENTOS_PADRAO, nomeFinal, ehAudio, ehImagem, ehPdf } from '../src/main/padrao';

describe('padrão da pasta do cliente', () => {
  it('conhece as pastas e os documentos do padrão', () => {
    expect(PASTAS_PADRAO).toEqual(['Contratos', 'Documentos', 'Não juntar', 'Entrevista']);
    expect(DOCUMENTOS_PADRAO.map((d) => d.nome)).toEqual([
      'Procuração',
      'Declaração',
      'RG',
      'CNH',
      'CTPS',
      'Contrato Trabalhista',
      'Comprovante de residência',
      'Perguntas entrevista',
      'Áudio da ligação',
      'Entrevista preenchida',
      'Transcrição',
    ]);
  });

  it('reconhece arquivo que já está no lugar certo com o nome certo', () => {
    expect(classificarCaminho('Contratos/Procuração.pdf')).toEqual({ situacao: 'no-lugar', tipo: 'Procuração' });
    expect(classificarCaminho('Documentos/RG.pdf')).toEqual({ situacao: 'no-lugar', tipo: 'RG' });
    expect(classificarCaminho('Não juntar/Contrato Trabalhista.pdf')).toEqual({ situacao: 'no-lugar', tipo: 'Contrato Trabalhista' });
    expect(classificarCaminho('Entrevista/Áudio da ligação.wav')).toEqual({ situacao: 'no-lugar', tipo: 'Áudio da ligação' });
    expect(classificarCaminho('Entrevista/Entrevista preenchida.pdf')).toEqual({ situacao: 'no-lugar', tipo: 'Entrevista preenchida' });
  });

  it('aceita variações de caixa, acento e espaços no nome', () => {
    expect(classificarCaminho('contratos/PROCURACAO.PDF')).toEqual({ situacao: 'no-lugar', tipo: 'Procuração' });
    expect(classificarCaminho('Entrevista/Perguntas entrevista .pdf')).toEqual({ situacao: 'no-lugar', tipo: 'Perguntas entrevista' });
    expect(classificarCaminho('Documentos\\ctps.pdf')).toEqual({ situacao: 'no-lugar', tipo: 'CTPS' });
  });

  it('arquivo com nome padrão na pasta errada precisa só ser movido', () => {
    expect(classificarCaminho('Procuração.pdf')).toEqual({ situacao: 'mover', tipo: 'Procuração' });
    expect(classificarCaminho('Perguntas entrevista .pdf')).toEqual({ situacao: 'mover', tipo: 'Perguntas entrevista' });
    expect(classificarCaminho('Documentos/Declaração.pdf')).toEqual({ situacao: 'mover', tipo: 'Declaração' });
  });

  it('áudio solto em qualquer pasta é áudio da ligação', () => {
    expect(classificarCaminho('ligacao-joao.mp3')).toEqual({ situacao: 'mover', tipo: 'Áudio da ligação' });
    expect(classificarCaminho('Entrevista/gravação.m4a')).toEqual({ situacao: 'mover', tipo: 'Áudio da ligação' });
  });

  it('o que não bate com o padrão precisa de classificação', () => {
    expect(classificarCaminho('WhatsApp Image 2026-10-01.jpeg')).toEqual({ situacao: 'classificar' });
    expect(classificarCaminho('doc (2).pdf')).toEqual({ situacao: 'classificar' });
    expect(classificarCaminho('Documentos/foto.pdf')).toEqual({ situacao: 'classificar' });
  });

  it('ignora arquivos internos do sistema', () => {
    expect(classificarCaminho('Thumbs.db')).toEqual({ situacao: 'ignorar' });
    expect(classificarCaminho('desktop.ini')).toEqual({ situacao: 'ignorar' });
    expect(classificarCaminho('_substituidos/RG.pdf')).toEqual({ situacao: 'ignorar' });
    expect(classificarCaminho('Revisar/x.pdf')).toEqual({ situacao: 'ignorar' });
  });

  it('transcrição pronta (txt, docx ou pdf com "transcri" no nome) é documento da Entrevista', () => {
    expect(classificarCaminho('Transcrição.txt')).toEqual({ situacao: 'mover', tipo: 'Transcrição' });
    expect(classificarCaminho('ligação/transcricao da entrevista.docx')).toEqual({ situacao: 'mover', tipo: 'Transcrição' });
    expect(classificarCaminho('Transcript.pdf')).toEqual({ situacao: 'mover', tipo: 'Transcrição' });
    expect(classificarCaminho('Entrevista/Transcrição.txt')).toEqual({ situacao: 'no-lugar', tipo: 'Transcrição' });
    expect(classificarCaminho('Entrevista/Transcrição.docx')).toEqual({ situacao: 'no-lugar', tipo: 'Transcrição' });
    expect(classificarCaminho('transcrição.jpg')).toEqual({ situacao: 'classificar' });
    expect(nomeFinal('Transcrição', '.docx')).toBe('Entrevista/Transcrição.docx');
  });

  it('dá o caminho final de cada tipo', () => {
    expect(nomeFinal('RG', '.pdf')).toBe('Documentos/RG.pdf');
    expect(nomeFinal('Áudio da ligação', '.wav')).toBe('Entrevista/Áudio da ligação.wav');
    expect(nomeFinal('Comprovante de residência', '.pdf')).toBe('Não juntar/Comprovante de residência.pdf');
  });

  it('detecta tipos de arquivo pela extensão', () => {
    expect(ehAudio('x.WAV')).toBe(true);
    expect(ehAudio('x.opus')).toBe(true);
    expect(ehAudio('x.pdf')).toBe(false);
    expect(ehImagem('x.jpeg')).toBe(true);
    expect(ehImagem('x.PNG')).toBe(true);
    expect(ehPdf('x.pdf')).toBe(true);
  });
});
