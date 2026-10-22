// A IA de verdade (Claude ou ChatGPT, pela assinatura) decidindo empresa e terceirização em casos INVENTADOS.
// Só roda com TESTE_REAL=1. Nenhum dado de cliente: nomes, datas e CNPJs são de exemplo.
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { etapaEmpresa, type AnaliseEmpresa } from '../../src/main/etapas/empresa';
import { ARQUIVO_CONVERSA } from '../../src/main/etapas/whatsapp';
import { Fila } from '../../src/main/fila';
import type { Contexto } from '../../src/main/job';
import { ProvedorClaude } from '../../src/main/provedores/claude';
import { ProvedorCodex } from '../../src/main/provedores/codex';
import { localizarExecutavel } from '../../src/main/provedores/localizar';
import type { Provedor } from '../../src/main/provedores/tipos';

const REAL = process.env.TESTE_REAL === '1';
const PROVEDOR = (process.env.PROVEDOR ?? 'claude') as 'claude' | 'codex';

function provedor(): Provedor {
  const exe = localizarExecutavel(PROVEDOR)!;
  return PROVEDOR === 'claude' ? new ProvedorClaude({ executavel: exe, timeoutMs: 10 * 60_000 }) : new ProvedorCodex({ executavel: exe, timeoutMs: 10 * 60_000 });
}

async function pdfComTexto(destino: string, linhas: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument();
    const s = doc.pipe(createWriteStream(destino));
    for (const l of linhas) doc.text(l);
    doc.end();
    s.on('finish', () => resolve());
    s.on('error', reject);
  });
}

/** Saída de cada contrato: um recente (dentro da régua) e um antigo, que a pessoa cita no WhatsApp. */
const ha = (meses: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - meses);
  return d.toLocaleDateString('pt-BR');
};

async function analisar(caso: { transcricao: string; conversa: string; ctps: string[] }): Promise<AnaliseEmpresa> {
  const dir = mkdtempSync(join(tmpdir(), 'empresa-real-'));
  const cliente = join(dir, 'Cliente Exemplo');
  const pastaJob = join(dir, 'job');
  mkdirSync(join(cliente, 'Documentos'), { recursive: true });
  mkdirSync(pastaJob);
  await pdfComTexto(join(cliente, 'Documentos', 'CTPS.pdf'), [
    'Carteira de Trabalho Digital - Contratos de trabalho',
    ...caso.ctps,
    'Documento gerado pelo aplicativo Carteira de Trabalho Digital. Os dados são os informados pelo empregador no eSocial.',
  ]);
  writeFileSync(join(pastaJob, 'dados-cliente.json'), JSON.stringify({ nome: 'Cliente Exemplo' }));
  writeFileSync(join(pastaJob, 'perguntas.json'), JSON.stringify([{ numero: 1, secao: 'Local de trabalho', pergunta: 'Qual era o endereço onde você trabalhava?', simNao: false }]));
  writeFileSync(join(pastaJob, 'transcricao.txt'), caso.transcricao);
  writeFileSync(join(pastaJob, ARQUIVO_CONVERSA), caso.conversa);
  const fila = new Fila(join(dir, 'jobs.json'));
  const ctx: Contexto = { fila, pastaJob, job: fila.adicionar(cliente), log: () => {} };
  await etapaEmpresa(provedor).executar(ctx);
  return JSON.parse(readFileSync(join(pastaJob, 'empresa.json'), 'utf8')) as AnaliseEmpresa;
}

describe.skipIf(!REAL || !localizarExecutavel(PROVEDOR))('empresa com a IA real (casos inventados)', () => {
  it('vigilante de empresa terceirizada num hospital: acha a tomadora pelo nome e pede o CNPJ; descarta a empresa antiga citada no WhatsApp', { timeout: 10 * 60_000 }, async () => {
    const a = await analisar({
      transcricao:
        'Falante 1: Em qual empresa você trabalhou por último?\nFalante 2: Na Guarda Forte Vigilância. Eu era vigilante, mas ficava o tempo todo dentro do Hospital Santa Clara, era lá que eu trabalhava.\n' +
        `Falante 1: E quando você saiu?\nFalante 2: Saí em ${ha(4)}, fiquei uns três anos lá.`,
      conversa: `[01/02/2026 10:00] Cliente: Oi, quero ver meus direitos da Padaria Pão de Mel\n[01/02/2026 10:05] Escritório: Quando você saiu de lá?\n[01/02/2026 10:06] Cliente: Faz tempo, em 2019. Depois fui pra vigilância`,
      ctps: [
        `GUARDA FORTE VIGILANCIA LTDA - CNPJ 00.000.000/0001-91 - Vigilante - Admissão ${ha(40)} - Desligamento ${ha(4)}`,
        'PADARIA PAO DE MEL LTDA - CNPJ 11.222.333/0001-81 - Balconista - Admissão 01/02/2016 - Desligamento 10/05/2019',
      ],
    });
    console.log(JSON.stringify(a, null, 2));
    expect(a.empregadora.nome).toMatch(/GUARDA FORTE/i);
    expect(a.empregadora.confirmadaNaCtps).toBe(true);
    expect(a.descartadas.map((d) => d.nome).join(' ')).toMatch(/P[ÃA]O DE MEL/i);
    expect(a.terceirizado).toBe(true);
    expect(a.tomadora.nome).toMatch(/Santa Clara/i);
    expect(a.pendencias.map((p) => p.curta)).toEqual(['CNPJ da tomadora']);
  });

  it('terceirizada numa fábrica que ela não sabe o nome: pede os dados da tomadora', { timeout: 10 * 60_000 }, async () => {
    const a = await analisar({
      transcricao:
        'Falante 1: Onde você trabalhava?\nFalante 2: Eu era registrada na Limpa Bem Serviços, mas trabalhava fazendo a limpeza dentro de uma fábrica de peças, não lembro o nome da fábrica.\n' +
        `Falante 1: Até quando?\nFalante 2: Até ${ha(8)}, foi mais de um ano.`,
      conversa: '',
      ctps: [`LIMPA BEM SERVICOS LTDA - CNPJ 00.000.000/0001-91 - Auxiliar de limpeza - Admissão ${ha(26)} - Desligamento ${ha(8)}`],
    });
    console.log(JSON.stringify(a, null, 2));
    expect(a.empregadora.nome).toMatch(/LIMPA BEM/i);
    expect(a.terceirizado).toBe(true);
    expect(a.tomadora.nome).toBeNull();
    expect(a.pendencias.map((p) => p.curta)).toContain('solicitar dados da tomadora');
  });
});
