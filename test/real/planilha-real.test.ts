// Planilha de verdade. Só roda com TESTE_REAL=1, a conta de serviço no .env (do projeto ou do app) e o link da planilha nos ajustes do app deste PC.
// Lê a aba real; GRAVA SÓ NUMA CÓPIA TEMPORÁRIA DA ABA, apagada no fim, e confere que a aba real não mudou.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auth as authGoogle, sheets as criarSheets } from '@googleapis/sheets';
import { Config } from '../../src/main/config';
import { apiGoogle, ClientePlanilha, idDaPlanilha } from '../../src/main/ferramentas/planilha';

const REAL = process.env.TESTE_REAL === '1';
const DADOS = process.env.ORGANIZADOR_DADOS ?? join(process.env.APPDATA ?? '', 'Organizador de Pastas Furtado');
const CONTA = REAL ? new Config(DADOS, [join(process.cwd(), '.env')]).contaServico() : null;
const AJUSTES = join(DADOS, 'settings.json');
const CLIENTE = process.env.CLIENTE_TESTE ?? '';

describe.skipIf(!CONTA || !CLIENTE || !existsSync(AJUSTES))('planilha real', () => {
  it('acha o cliente na aba real e marca Pasta pronta numa cópia da aba', async () => {
    const credenciais = CONTA!.credenciais;
    const ajustes = JSON.parse(readFileSync(AJUSTES, 'utf8')) as { planilhaId: string; planilhaAba?: string };
    const planilhaId = idDaPlanilha(ajustes.planilhaId);
    const aba = ajustes.planilhaAba || 'Lançamentos';

    const real = new ClientePlanilha(apiGoogle({ credenciais, planilhaId, aba }));
    console.log(await real.testar());
    const achados = await real.procurarPorNome(CLIENTE);
    console.log('linhas com o nome:', achados.map((l) => `${l.linha} (${l.grau}) F="${l.pastaPronta}"`).join('; '));
    expect(achados.length).toBeGreaterThan(0);
    const alvo = achados[0];

    const s = criarSheets({ version: 'v4', auth: new authGoogle.GoogleAuth({ credentials: credenciais, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) });
    const meta = await s.spreadsheets.get({ spreadsheetId: planilhaId, fields: 'sheets.properties(sheetId,title)' });
    const idReal = meta.data.sheets!.find((x) => x.properties?.title === aba)!.properties!.sheetId!;
    const nomeCopia = `Teste robô ${Date.now()}`;
    const copia = await s.spreadsheets.batchUpdate({
      spreadsheetId: planilhaId,
      requestBody: { requests: [{ duplicateSheet: { sourceSheetId: idReal, newSheetName: nomeCopia, insertSheetIndex: 99 } }] },
    });
    const idCopia = copia.data.replies![0].duplicateSheet!.properties!.sheetId!;
    try {
      const linhaReal = async () => (await s.spreadsheets.values.get({ spreadsheetId: planilhaId, range: `'${aba}'!A${alvo.linha}:K${alvo.linha}` })).data.values?.[0];
      const antes = await linhaReal();

      const naCopia = new ClientePlanilha(apiGoogle({ credenciais, planilhaId, aba: nomeCopia }));
      const r = await naCopia.marcarPastaPronta({ nome: alvo.nome, telefone: alvo.telefone }, '21/10 Robô: teste do app (cópia da aba)');
      console.log('resultado na cópia:', JSON.stringify(r));
      const linhaCopia = (await s.spreadsheets.values.get({ spreadsheetId: planilhaId, range: `'${nomeCopia}'!A${alvo.linha}:K${alvo.linha}` })).data.values?.[0] ?? [];
      console.log('linha na cópia depois:', JSON.stringify(linhaCopia.slice(1, 10).map((c, i) => (i === 1 ? '(telefone)' : c))));
      if (alvo.pastaPronta === '') {
        expect(r.status).toBe('marcado');
        expect(linhaCopia[5]).toBe('Sim');
        expect(String(linhaCopia[9] ?? '')).toMatch(/21\/10 Robô: teste do app \(cópia da aba\)$/);
        const cor = (
          await s.spreadsheets.get({ spreadsheetId: planilhaId, ranges: [`'${nomeCopia}'!K${alvo.linha}`], fields: 'sheets.data.rowData.values.userEnteredFormat.backgroundColor' })
        ).data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.userEnteredFormat?.backgroundColor;
        console.log('cor do marcador na cópia:', JSON.stringify(cor));
        expect((cor?.green ?? 0) > 0.5).toBe(true);
      }
      // a aba real não mudou
      expect(await linhaReal()).toEqual(antes);
    } finally {
      await s.spreadsheets.batchUpdate({ spreadsheetId: planilhaId, requestBody: { requests: [{ deleteSheet: { sheetId: idCopia } }] } });
      const depois = await s.spreadsheets.get({ spreadsheetId: planilhaId, fields: 'sheets.properties.title' });
      console.log('abas no fim:', depois.data.sheets!.map((x) => x.properties?.title).join(', '));
    }
  }, 120_000);
});
