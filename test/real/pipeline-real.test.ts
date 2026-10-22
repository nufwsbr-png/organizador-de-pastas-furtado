// Processo completo numa CÓPIA de uma pasta real. Só roda com TESTE_REAL=1 (usa a assinatura, o .env do projeto
// e o link da planilha e o endereço do WAHA dos ajustes do app deste PC).
// Padrão: a pasta PASTA_ORIGEM (um cliente completo) reduzida ao que chega nas pastas novas (entrevista não preenchida e áudio); ZapSign e
// WhatsApp têm de trazer o resto. Com PASTA_CLIENTE=<pasta>, copia essa pasta inteira, do jeito que chegou.
// A planilha é uma CÓPIA TEMPORÁRIA DA ABA, apagada no fim; o teste confere que a linha real não mudou.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { auth as authGoogle, sheets as criarSheets } from '@googleapis/sheets';
import { Config, type Ajustes } from '../../src/main/config';
import { etapaClassificar } from '../../src/main/etapas/classificar';
import { etapaCliente } from '../../src/main/etapas/cliente';
import { etapaEntregarEntrevista } from '../../src/main/etapas/entregar-entrevista';
import { inventariar } from '../../src/main/etapas/inventario';
import { etapaMover } from '../../src/main/etapas/mover';
import { etapaPdfEntrevista } from '../../src/main/etapas/pdf-entrevista';
import { etapaPerguntas } from '../../src/main/etapas/perguntas';
import { etapaPlanilha } from '../../src/main/etapas/planilha';
import { etapaRespostas } from '../../src/main/etapas/respostas';
import { etapaTranscricao } from '../../src/main/etapas/transcricao';
import { etapaWhatsapp } from '../../src/main/etapas/whatsapp';
import { etapaZapsign } from '../../src/main/etapas/zapsign';
import { transcreverElevenLabs } from '../../src/main/ferramentas/elevenlabs';
import { transcreverOpenRouter } from '../../src/main/ferramentas/openrouter';
import { etapaEmpresa } from '../../src/main/etapas/empresa';
import { apiGoogle, ClientePlanilha, idDaPlanilha } from '../../src/main/ferramentas/planilha';
import { ClienteWaha } from '../../src/main/ferramentas/waha';
import { ClienteZapsign } from '../../src/main/ferramentas/zapsign';
import type { Job } from '../../src/main/fila';
import type { Etapa } from '../../src/main/job';
import { Orquestrador } from '../../src/main/orquestrador';
import { ProvedorClaude } from '../../src/main/provedores/claude';
import { ProvedorCodex } from '../../src/main/provedores/codex';
import { localizarExecutavel } from '../../src/main/provedores/localizar';
import type { Provedor } from '../../src/main/provedores/tipos';

const REAL = process.env.TESTE_REAL === '1';
const ORIGEM = process.env.PASTA_ORIGEM ?? '';
const PASTA_CLIENTE = process.env.PASTA_CLIENTE;
const DADOS = process.env.ORGANIZADOR_DADOS ?? join(process.env.APPDATA ?? '', 'Organizador de Pastas Furtado');
const AJUSTES = join(DADOS, 'settings.json');
const PROVEDOR = (process.env.PROVEDOR ?? 'claude') as 'claude' | 'codex';
const DESTINO = process.env.PASTA_DESTINO;
const CHEGAM = ['Entrevista/Perguntas entrevista.pdf', 'Entrevista/Áudio da ligação.wav'];
const ASSINADOS = ['Contratos/Procuração.pdf', 'Contratos/Declaração.pdf', 'Não juntar/Contrato Trabalhista.pdf'];

const listar = (dir: string, prefixo = ''): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listar(join(dir, e.name), `${prefixo}${e.name}/`) : [`${prefixo}${e.name}`]));

/** Roda as etapas do app (mesma ordem de src/main/index.ts) na pasta `cliente`, com a planilha numa cópia temporária da aba. */
async function processoReal(cliente: string, base: string, nomeNaPlanilha: string): Promise<Job> {
  const config = new Config(join(base, 'userData'), [join(process.cwd(), '.env')]);
  const ajustes = JSON.parse(readFileSync(AJUSTES, 'utf8')) as Partial<Ajustes> & { planilhaId: string };
  // transcrição como nos Ajustes do app; sem a escolha gravada, OpenRouter quando não há chave do ElevenLabs
  const porOpenRouter = (ajustes.transcricao ?? (config.chaveElevenLabs() ? 'elevenlabs' : 'openrouter')) === 'openrouter';
  const conta = config.contaServico();
  expect(conta).toBeTruthy();
  expect(ajustes.wahaUrl).toBeTruthy();

  const planilhaId = idDaPlanilha(ajustes.planilhaId);
  const aba = ajustes.planilhaAba || 'Lançamentos';
  const s = criarSheets({ version: 'v4', auth: new authGoogle.GoogleAuth({ credentials: conta!.credenciais, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) });
  const meta = await s.spreadsheets.get({ spreadsheetId: planilhaId, fields: 'sheets.properties(sheetId,title)' });
  const idReal = meta.data.sheets!.find((x) => x.properties?.title === aba)!.properties!.sheetId!;
  const nomeCopia = `Teste robô ${Date.now()}`;
  const copia = await s.spreadsheets.batchUpdate({
    spreadsheetId: planilhaId,
    requestBody: { requests: [{ duplicateSheet: { sourceSheetId: idReal, newSheetName: nomeCopia, insertSheetIndex: 99 } }] },
  });
  const idCopia = copia.data.replies![0].duplicateSheet!.properties!.sheetId!;
  // a equipe pode estar mexendo na planilha: confere só as linhas com o nome do cliente na aba real
  const daCliente = await new ClientePlanilha(apiGoogle({ credenciais: conta!.credenciais, planilhaId, aba })).procurarPorNome(nomeNaPlanilha);
  const linhasReais = async () =>
    Promise.all(daCliente.map(async (l) => (await s.spreadsheets.values.get({ spreadsheetId: planilhaId, range: `'${aba}'!A${l.linha}:K${l.linha}` })).data.values));
  const antes = await linhasReais();

  try {
    const planilha = new ClientePlanilha(apiGoogle({ credenciais: conta!.credenciais, planilhaId, aba: nomeCopia }));
    const zapsign = new ClienteZapsign({ token: () => config.tokenZapsign(), arquivoIndice: join(base, 'userData', 'zapsign-indice.json') });
    const waha = new ClienteWaha({ url: () => ajustes.wahaUrl!, apiKey: () => config.chaveWaha(), sessao: () => ajustes.wahaSessao || 'furtado' });
    const exe = localizarExecutavel(PROVEDOR)!;
    const provedor = (): Provedor =>
      PROVEDOR === 'claude' ? new ProvedorClaude({ executavel: exe, timeoutMs: 25 * 60_000 }) : new ProvedorCodex({ executavel: exe, timeoutMs: 25 * 60_000 });
    // mesma ordem do app (src/main/index.ts)
    const etapas = (): Etapa[] => [
      {
        nome: 'inventario',
        saida: 'inventario.json',
        async executar(ctx) {
          inventariar(ctx.job.pasta, join(ctx.pastaJob, 'inventario.json'));
          return { status: 'ok' };
        },
      },
      etapaPerguntas(provedor),
      etapaZapsign(() => zapsign),
      etapaCliente({ planilha: () => planilha, zapsign: () => zapsign }),
      etapaWhatsapp(() => waha),
      etapaTranscricao({
        chave: () => (porOpenRouter ? config.chaveOpenRouter() : config.chaveElevenLabs()),
        transcrever: (a, k) => (porOpenRouter ? transcreverOpenRouter(a, k, { modelo: ajustes.modeloOpenRouter }) : transcreverElevenLabs(a, k)),
      }),
      etapaClassificar(provedor),
      etapaMover(),
      etapaEmpresa(provedor),
      etapaRespostas(provedor),
      etapaPdfEntrevista(),
      etapaEntregarEntrevista(),
      etapaPlanilha(() => planilha),
    ];
    const orq = new Orquestrador({ userData: join(base, 'userData'), paralelismo: () => 1, etapas });
    const job = orq.adicionarPasta(cliente);
    const inicio = Date.now();
    await orq.organizar(job.id);
    const final = orq.jobs()[0];
    console.log('estado:', final.estado, '| pendentes:', final.etapasPendentes.join(', ') || '-', '| min:', ((Date.now() - inicio) / 60000).toFixed(1));
    console.log('motivo:', final.motivo);
    for (const m of final.mensagens) console.log(`  [${m.nivel}] ${m.texto}`);
    console.log('ÁRVORE FINAL:\n  ' + listar(cliente).join('\n  '));
    const marcada = await planilha.procurarPorNome(nomeNaPlanilha);
    console.log('na cópia da aba:', marcada.map((l) => `linha ${l.linha}: Pasta pronta="${l.pastaPronta}" | Obs="${l.observacoes}"`).join('; ') || 'nome não encontrado');
    return final;
  } finally {
    await s.spreadsheets.batchUpdate({ spreadsheetId: planilhaId, requestBody: { requests: [{ deleteSheet: { sheetId: idCopia } }] } });
    expect(await linhasReais()).toEqual(antes);
    console.log(`linha(s) ${daCliente.map((l) => l.linha).join(', ') || '-'} da aba real sem mudanças; cópia "${nomeCopia}" apagada`);
  }
}

describe.skipIf(!REAL || !existsSync(AJUSTES))('pipeline real', () => {
  it.skipIf(!!PASTA_CLIENTE || !existsSync(ORIGEM))('organiza uma cópia da pasta PASTA_ORIGEM que chega só com a entrevista e o áudio', async () => {
    const base = DESTINO ?? mkdtempSync(join(tmpdir(), 'pipeline-'));
    const cliente = join(base, basename(ORIGEM));
    if (existsSync(cliente)) rmSync(cliente, { recursive: true, force: true });
    mkdirSync(join(cliente, 'Entrevista'), { recursive: true });
    for (const rel of CHEGAM) cpSync(join(ORIGEM, rel), join(cliente, rel));
    console.log('cópia em', cliente);

    const final = await processoReal(cliente, base, process.env.CLIENTE_TESTE ?? basename(ORIGEM));
    expect(['concluido', 'atencao']).toContain(final.estado);
    for (const rel of CHEGAM) expect(existsSync(join(cliente, rel))).toBe(true);
    for (const rel of ASSINADOS) expect(readFileSync(join(cliente, rel)).equals(readFileSync(join(ORIGEM, rel)))).toBe(true);
    expect(readFileSync(join(cliente, 'Documentos', 'CTPS.pdf')).equals(readFileSync(join(ORIGEM, 'Documentos', 'CTPS.pdf')))).toBe(true);
    expect(existsSync(join(cliente, 'Documentos', 'RG.pdf'))).toBe(true);
    expect(existsSync(join(cliente, 'WhatsApp'))).toBe(false);
  }, 40 * 60_000);

  it.skipIf(!PASTA_CLIENTE)('organiza uma cópia da pasta PASTA_CLIENTE do jeito que chegou', async () => {
    const base = DESTINO ?? mkdtempSync(join(tmpdir(), 'pipeline-'));
    const cliente = join(base, basename(PASTA_CLIENTE!));
    if (existsSync(cliente)) rmSync(cliente, { recursive: true, force: true });
    cpSync(PASTA_CLIENTE!, cliente, { recursive: true });
    console.log('cópia em', cliente, '\nCHEGOU:\n  ' + listar(cliente).join('\n  '));

    const final = await processoReal(cliente, base, process.env.CLIENTE_TESTE ?? basename(PASTA_CLIENTE!));
    expect(['concluido', 'atencao']).toContain(final.estado);
    expect(existsSync(join(cliente, 'WhatsApp'))).toBe(false);
  }, 40 * 60_000);
});
