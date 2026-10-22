import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import type { Etapa } from '../job';
import { nomeDoCliente } from './cliente';
import type { AnaliseEmpresa } from './empresa';
import type { DadosCliente, Pergunta } from './perguntas';
import type { OutraPergunta, Resposta } from './respostas';

export interface DadosPdfEntrevista {
  destino: string;
  cliente: string;
  dadosCliente?: DadosCliente;
  /** Empresa do processo e tomadora, confirmadas pela etapa "empresa". */
  empresa?: AnaliseEmpresa;
  perguntas: Pergunta[];
  respostas: Resposta[];
  /** Perguntas feitas na ligação que não estão no roteiro. */
  outrasPerguntas?: OutraPergunta[];
  transcricao: string;
  geradoEm?: Date;
}

const NAO_ABORDADO = 'Não abordado na ligação.';
const COR_SECAO = '#8a6d00';
const COR_PENDENCIA = '#a4161a';

/** "Empresa do processo": empregadora, tomadora (se terceirizado), descartadas e o que a equipe precisa pedir. */
function escreverEmpresa(doc: PDFKit.PDFDocument, a: AnaliseEmpresa): void {
  const e = a.empregadora;
  const linha = (rotulo: string, valor: string) => {
    doc.font('Helvetica-Bold').fontSize(10.5).text(`${rotulo}: `, { continued: true }).font('Helvetica').text(valor);
  };
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COR_SECAO).text('EMPRESA DO PROCESSO').fillColor('#000000');
  doc.moveDown(0.3);
  linha('Empregadora', e.nome ? `${e.nome}${e.cnpj ? ` · CNPJ ${e.cnpj}` : ''}` : 'não identificada');
  if (e.endereco) linha('Endereço', e.endereco);
  const contrato = [e.cargo, e.admissao && `admissão ${e.admissao}`, e.demissao && `saída ${e.demissao}`].filter(Boolean).join(' · ');
  if (contrato) linha('Contrato', contrato);
  if (e.nome) linha('CTPS', e.confirmadaNaCtps ? 'empresa confirmada na carteira' : a.ctpsNaPasta ? 'empresa não encontrada na carteira' : 'a CTPS não estava na pasta');
  if (a.terceirizado) {
    const t = a.tomadora;
    linha('Tomadora de serviços', t.nome ? `${t.nome}${t.cnpj ? ` · CNPJ ${t.cnpj}` : ''}${t.endereco ? ` · ${t.endereco}` : ''}` : 'caso terceirizado, sem os dados da tomadora');
  }
  if (a.descartadas.length > 0) linha('Descartadas', a.descartadas.map((d) => `${d.nome} (${d.motivo})`).join('; '));
  if (a.justificativa) doc.font('Helvetica-Oblique').fontSize(9.5).fillColor('#555555').text(a.justificativa, { align: 'justify' }).fillColor('#000000');
  if (a.pendencias.length > 0) {
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COR_PENDENCIA).text('Pendências');
    doc.font('Helvetica').fontSize(10.5);
    for (const p of a.pendencias) doc.text(`• ${p.texto}`, { align: 'justify' });
    doc.fillColor('#000000');
  }
  doc.moveDown(1);
}

/** Gera o PDF da entrevista preenchida: cabeçalho, empresa, perguntas por seção com as respostas e a transcrição em anexo. */
export async function gerarPdfEntrevista(dados: DadosPdfEntrevista): Promise<void> {
  const { destino, cliente, dadosCliente, empresa, perguntas, respostas, outrasPerguntas = [], transcricao, geradoEm = new Date() } = dados;
  const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 }, info: { Title: `Entrevista - ${cliente}` } });
  const saida = doc.pipe(createWriteStream(destino));

  doc.font('Helvetica-Bold').fontSize(18).text('Entrevista trabalhista', { align: 'left' });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(14).text(cliente);
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).fillColor('#444444');
  const linhasCabecalho = [
    dadosCliente?.telefone ? `Telefone: ${dadosCliente.telefone}` : null,
    dadosCliente?.empresa && !empresa ? `Empresa: ${dadosCliente.empresa}` : null,
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
  if (empresa) escreverEmpresa(doc, empresa);

  let secaoAtual = '';
  for (const p of perguntas) {
    const r = respostas.find((x) => x.numero === p.numero);
    if (p.secao && p.secao !== secaoAtual) {
      secaoAtual = p.secao;
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(12).fillColor(COR_SECAO).text(secaoAtual.toUpperCase());
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
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COR_SECAO).text('Outras perguntas feitas');
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
    dependeDe: ['respostas', 'empresa'],
    async executar(ctx) {
      const perguntas = JSON.parse(readFileSync(join(ctx.pastaJob, 'perguntas.json'), 'utf8')) as Pergunta[];
      const respostas = JSON.parse(readFileSync(join(ctx.pastaJob, 'respostas.json'), 'utf8')) as Resposta[];
      const transcricao = readFileSync(join(ctx.pastaJob, 'transcricao.txt'), 'utf8');
      const arquivoDados = join(ctx.pastaJob, 'dados-cliente.json');
      const dadosCliente = existsSync(arquivoDados) ? (JSON.parse(readFileSync(arquivoDados, 'utf8')) as DadosCliente) : undefined;
      const arquivoOutras = join(ctx.pastaJob, 'outras-perguntas.json');
      const outrasPerguntas = existsSync(arquivoOutras) ? (JSON.parse(readFileSync(arquivoOutras, 'utf8')) as OutraPergunta[]) : [];
      const arquivoEmpresa = join(ctx.pastaJob, 'empresa.json');
      const empresa = existsSync(arquivoEmpresa) ? (JSON.parse(readFileSync(arquivoEmpresa, 'utf8')) as AnaliseEmpresa) : undefined;
      await gerarPdfEntrevista({
        destino: join(ctx.pastaJob, 'Entrevista preenchida.pdf'),
        cliente: nomeDoCliente(ctx),
        dadosCliente,
        empresa,
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
