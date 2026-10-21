import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import type { Etapa } from '../job';
import { nomeDoCliente } from './cliente';
import type { DadosCliente, Pergunta } from './perguntas';
import type { OutraPergunta, Resposta } from './respostas';

export interface DadosPdfEntrevista {
  destino: string;
  cliente: string;
  dadosCliente?: DadosCliente;
  perguntas: Pergunta[];
  respostas: Resposta[];
  /** Perguntas feitas na ligação que não estão no roteiro. */
  outrasPerguntas?: OutraPergunta[];
  transcricao: string;
  geradoEm?: Date;
}

const NAO_ABORDADO = 'Não abordado na ligação.';

/** Gera o PDF da entrevista preenchida: cabeçalho, perguntas por seção com as respostas e a transcrição em anexo. */
export async function gerarPdfEntrevista(dados: DadosPdfEntrevista): Promise<void> {
  const { destino, cliente, dadosCliente, perguntas, respostas, outrasPerguntas = [], transcricao, geradoEm = new Date() } = dados;
  const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 }, info: { Title: `Entrevista - ${cliente}` } });
  const saida = doc.pipe(createWriteStream(destino));

  doc.font('Helvetica-Bold').fontSize(18).text('Entrevista trabalhista', { align: 'left' });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(14).text(cliente);
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).fillColor('#444444');
  const linhasCabecalho = [
    dadosCliente?.telefone ? `Telefone: ${dadosCliente.telefone}` : null,
    dadosCliente?.empresa ? `Empresa: ${dadosCliente.empresa}` : null,
    dadosCliente?.cargo ? `Cargo: ${dadosCliente.cargo}` : null,
    dadosCliente?.vinculo ? `Vínculo: ${dadosCliente.vinculo}` : null,
    dadosCliente?.salario ? `Salário: ${dadosCliente.salario}` : null,
    `Preenchido automaticamente a partir da transcrição da ligação em ${geradoEm.toLocaleDateString('pt-BR')}.`,
    perguntas.some((p) => p.respostaNoPdf)
      ? 'Os dados que já vinham no documento da entrevista foram mantidos; as demais respostas usam somente o que o cliente disse na ligação. Confira antes de usar.'
      : 'As respostas usam somente o que o cliente disse na ligação; confira antes de usar.',
  ].filter((l): l is string => Boolean(l));
  for (const l of linhasCabecalho) doc.text(l);
  doc.fillColor('#000000');
  doc.moveDown(1);

  let secaoAtual = '';
  for (const p of perguntas) {
    const r = respostas.find((x) => x.numero === p.numero);
    if (p.secao && p.secao !== secaoAtual) {
      secaoAtual = p.secao;
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#8a6d00').text(secaoAtual.toUpperCase());
      doc.fillColor('#000000');
      doc.moveDown(0.3);
    }
    doc.font('Helvetica-Bold').fontSize(11).text(`${String(p.numero).padStart(2, '0')}. ${p.pergunta}`);
    doc.moveDown(0.15);
    if (p.simNao) {
      doc.font('Helvetica-Bold').fontSize(10.5).text(`Resposta: ${r?.simNao ?? '—'}`);
    }
    doc.font('Helvetica').fontSize(10.5);
    if (!r || r.naoRespondida || !r.resposta) {
      doc.font('Helvetica-Oblique').fillColor('#777777').text(NAO_ABORDADO).fillColor('#000000');
    } else {
      doc.text(r.resposta, { align: 'justify' });
    }
    doc.moveDown(0.8);
  }

  if (outrasPerguntas.length > 0) {
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#8a6d00').text('Outras perguntas feitas');
    doc.fillColor('#000000');
    doc.font('Helvetica-Oblique').fontSize(9.5).fillColor('#777777').text('Perguntas feitas na ligação que não estão no roteiro da entrevista.').fillColor('#000000');
    doc.moveDown(0.3);
    for (const o of outrasPerguntas) {
      doc.font('Helvetica-Bold').fontSize(11).text(o.pergunta);
      doc.moveDown(0.15);
      doc.font('Helvetica').fontSize(10.5).text(o.resposta, { align: 'justify' });
      doc.moveDown(0.8);
    }
  }

  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(14).text('Anexo — Transcrição da ligação');
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(9.5);
  for (const paragrafo of transcricao.split(/\n\s*\n/)) {
    doc.text(paragrafo.trim(), { align: 'left' });
    doc.moveDown(0.5);
  }

  doc.end();
  await new Promise<void>((resolve, reject) => {
    saida.on('finish', () => resolve());
    saida.on('error', reject);
  });
}

export function etapaPdfEntrevista(): Etapa {
  return {
    nome: 'pdf-entrevista',
    saida: 'Entrevista preenchida.pdf',
    dependeDe: ['respostas'],
    async executar(ctx) {
      const perguntas = JSON.parse(readFileSync(join(ctx.pastaJob, 'perguntas.json'), 'utf8')) as Pergunta[];
      const respostas = JSON.parse(readFileSync(join(ctx.pastaJob, 'respostas.json'), 'utf8')) as Resposta[];
      const transcricao = readFileSync(join(ctx.pastaJob, 'transcricao.txt'), 'utf8');
      const arquivoDados = join(ctx.pastaJob, 'dados-cliente.json');
      const dadosCliente = existsSync(arquivoDados) ? (JSON.parse(readFileSync(arquivoDados, 'utf8')) as DadosCliente) : undefined;
      const arquivoOutras = join(ctx.pastaJob, 'outras-perguntas.json');
      const outrasPerguntas = existsSync(arquivoOutras) ? (JSON.parse(readFileSync(arquivoOutras, 'utf8')) as OutraPergunta[]) : [];
      await gerarPdfEntrevista({
        destino: join(ctx.pastaJob, 'Entrevista preenchida.pdf'),
        cliente: nomeDoCliente(ctx),
        dadosCliente,
        perguntas,
        respostas,
        outrasPerguntas,
        transcricao,
      });
      const semResposta = respostas.filter((r) => r.naoRespondida).length;
      ctx.log(semResposta > 0 ? `PDF da entrevista gerado; ${semResposta} pergunta(s) ficaram sem resposta na ligação.` : 'PDF da entrevista gerado.');
      return { status: 'ok' };
    },
  };
}
