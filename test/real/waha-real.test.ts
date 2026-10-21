// WAHA de verdade (só leitura). Só roda com TESTE_REAL=1, WAHA_API_KEY e a conta do Google no .env do projeto,
// e o link da planilha nos ajustes do app deste PC. Pega o telefone do cliente CLIENTE_TESTE na planilha, acha a conversa
// no WhatsApp do escritório e baixa o que ele mandou para uma pasta temporária.
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '../../src/main/config';
import { apiGoogle, ClientePlanilha, idDaPlanilha } from '../../src/main/ferramentas/planilha';
import { ClienteWaha } from '../../src/main/ferramentas/waha';

const REAL = process.env.TESTE_REAL === '1';
const DADOS = process.env.ORGANIZADOR_DADOS ?? join(process.env.APPDATA ?? '', 'Organizador de Pastas Furtado');
const AJUSTES = join(DADOS, 'settings.json');
const CLIENTE = process.env.CLIENTE_TESTE ?? '';
const URL_WAHA = process.env.WAHA_URL ?? 'https://pastas.nufws.com.br';

describe.skipIf(!REAL || !CLIENTE || !existsSync(AJUSTES))('WAHA real', () => {
  it('acha a conversa do cliente e baixa as fotos e documentos que ele mandou', { timeout: 600_000 }, async () => {
    const config = new Config(mkdtempSync(join(tmpdir(), 'waha-real-')), [join(process.cwd(), '.env')]);
    const conta = config.contaServico();
    expect(conta).toBeTruthy();
    const ajustes = JSON.parse(readFileSync(AJUSTES, 'utf8')) as { planilhaId: string; planilhaAba?: string; wahaSessao?: string };
    const planilha = new ClientePlanilha(apiGoogle({ credenciais: conta!.credenciais, planilhaId: idDaPlanilha(ajustes.planilhaId), aba: ajustes.planilhaAba || 'Lançamentos' }));
    const [linha] = await planilha.procurarPorNome(CLIENTE);
    expect(linha?.telefone).toBeTruthy();

    const waha = new ClienteWaha({ url: () => URL_WAHA, apiKey: () => config.chaveWaha(), sessao: () => ajustes.wahaSessao || 'furtado' });
    console.log(await waha.testar());
    const conversa = await waha.acharConversa(linha.telefone);
    expect(conversa).toBeTruthy();
    console.log('conversa:', conversa!.ids.map((id) => id.replace(/^\d{6}/, '…')).join(' + '));

    const destino = mkdtempSync(join(tmpdir(), 'waha-real-midias-'));
    const recebidos: string[] = [];
    const inicio = Date.now();
    const resumo = await waha.midiasDoCliente(conversa!, async (a) => {
      const nome = `${recebidos.length + 1}-${a.nomeArquivo ?? a.mimetype.replace('/', '.')}`;
      writeFileSync(join(destino, nome), a.conteudo);
      const sha = createHash('sha256').update(a.conteudo).digest('hex').slice(0, 12);
      recebidos.push(`${new Date(a.quando * 1000).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} ${a.mimetype} ${Math.round(a.conteudo.length / 1024)} KB ${sha}`);
    });
    console.log(`${resumo.mensagens} mensagem(ns) do cliente, ${resumo.midias} arquivo(s), ${resumo.falhas.length} falha(s), ${Math.round((Date.now() - inicio) / 1000)} s`);
    console.log(recebidos.join('\n'));
    for (const f of resumo.falhas.slice(0, 5)) console.log('falha:', new Date(f.quando * 1000).toISOString(), f.motivo);
    console.log('arquivos em', destino);
    expect(resumo.mensagens).toBeGreaterThan(0);
  });
});
