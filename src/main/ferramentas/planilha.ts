import { auth as authGoogle, sheets as criarSheets } from '@googleapis/sheets';
import { normalizar } from '../padrao';
import { grauNome, mesmoTelefone } from './nomes';

/**
 * Planilha "Contratos/Entrevistas/Pastas" (Google Sheets) pela conta de serviço.
 * As colunas são achadas pelo nome do cabeçalho, porque a equipe insere e move colunas.
 * Toda gravação relocaliza a linha por nome + telefone, relê e desfaz se a linha mudou de dono
 * (a equipe edita a planilha enquanto o app trabalha). Mesmo padrão do robô em Desktop\organizar pasta.
 */

export type Cor = { red?: number | null; green?: number | null; blue?: number | null };

/** O que o app precisa da planilha (a API do Google ou uma falsa nos testes). Linhas e colunas começam em 1 e 0. */
export interface ApiPlanilha {
  /** Nome da planilha; falha se a aba não existir ou a conta não tiver acesso. */
  titulo(): Promise<string>;
  /** Valores formatados de um intervalo da aba (ex.: "A1:Z20"); linhas vazias do meio vêm como []. */
  ler(intervalo: string): Promise<string[][]>;
  gravar(celula: string, valor: string): Promise<void>;
  /** Cor de fundo de cada célula da coluna, da linha `deLinha` para baixo. */
  cores(coluna: number, deLinha: number): Promise<(Cor | undefined)[]>;
  /** Pinta uma célula; null volta para sem cor. */
  pintar(linha: number, coluna: number, cor: Cor | null): Promise<void>;
  /** Opções da lista suspensa da célula (validação "um item da lista"). */
  opcoesDaLista(celula: string): Promise<string[]>;
}

export interface LinhaPlanilha {
  linha: number;
  nome: string;
  telefone: string;
  pastaPronta: string;
  observacoes: string;
}

export type ResultadoMarcacao = { status: 'marcado' | 'ja-estava' | 'nao'; linha: number };

/** O que as etapas usam (o cliente real ou um falso nos testes). */
export interface FontePlanilha {
  procurarPorNome(nome: string): Promise<(LinhaPlanilha & { grau: 'igual' | 'parecido' })[]>;
  /** Marca Pasta pronta = Sim, pinta o marcador de verde e anota em Observações. Não mexe se estiver "Não". */
  marcarPastaPronta(cliente: { nome: string; telefone: string }, anotacao: string): Promise<ResultadoMarcacao>;
}

export class ErroPlanilha extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroPlanilha';
  }
}

interface Mapa {
  /** Linha do cabeçalho e primeira linha de dados. */
  cabecalho: number;
  inicio: number;
  nome: number;
  telefone: number;
  pasta: number;
  obs?: number;
  /** Coluna sem título logo depois de Observações, que a equipe pinta de verde. */
  marcador?: number;
  ultima: number;
}

export function letra(coluna: number): string {
  let n = coluna + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Acha a linha do cabeçalho e as colunas pelo nome (Nome do cliente, Número de telefone, Pasta pronta, Observações). */
export function mapearCabecalho(linhas: string[][]): Mapa {
  for (let i = 0; i < linhas.length; i++) {
    const cab = (linhas[i] ?? []).map((c) => normalizar(c ?? ''));
    const nome = cab.findIndex((c) => c.includes('nome'));
    const pasta = cab.findIndex((c) => c.includes('pasta pronta'));
    if (nome < 0 || pasta < 0) continue;
    const telefone = cab.findIndex((c) => /telefone|celular|whats/.test(c));
    if (telefone < 0) throw new ErroPlanilha('Achei o cabeçalho da planilha, mas não a coluna do telefone.');
    const obs = cab.findIndex((c) => c.includes('observa'));
    const marcador = obs >= 0 ? obs + 1 : undefined;
    return { cabecalho: i + 1, inicio: i + 2, nome, telefone, pasta, obs: obs >= 0 ? obs : undefined, marcador, ultima: Math.max(nome, telefone, pasta, obs, marcador ?? 0) };
  }
  throw new ErroPlanilha('Não achei o cabeçalho da planilha (colunas "Nome do cliente" e "Pasta pronta") nas primeiras linhas da aba.');
}

const ehVerde = (c?: Cor) => {
  if (!c) return false;
  const r = c.red ?? 0;
  const g = c.green ?? 0;
  const b = c.blue ?? 0;
  return g > 0.5 && g > r + 0.2 && g > b + 0.2;
};

export class ClientePlanilha implements FontePlanilha {
  private fila: Promise<unknown> = Promise.resolve();

  constructor(private api: ApiPlanilha) {}

  /** Confere acesso, aba e colunas; diz quantos clientes a aba tem. */
  async testar(): Promise<string> {
    const titulo = await this.api.titulo();
    const mapa = await this.mapa();
    const linhas = await this.linhas(mapa);
    const colunas = [`nome ${letra(mapa.nome)}`, `telefone ${letra(mapa.telefone)}`, `Pasta pronta ${letra(mapa.pasta)}`];
    if (mapa.obs !== undefined) colunas.push(`Observações ${letra(mapa.obs)}`);
    return `Planilha "${titulo}": ${linhas.length} cliente(s); colunas ${colunas.join(', ')}.`;
  }

  async procurarPorNome(nome: string): Promise<(LinhaPlanilha & { grau: 'igual' | 'parecido' })[]> {
    const linhas = await this.linhas(await this.mapa());
    return linhas.flatMap((l) => {
      const grau = grauNome(nome, l.nome);
      return grau ? [{ ...l, grau }] : [];
    });
  }

  marcarPastaPronta(cliente: { nome: string; telefone: string }, anotacao: string): Promise<ResultadoMarcacao> {
    return this.exclusivo(async () => {
      const mapa = await this.mapa();
      const l = await this.localizar(cliente, mapa);
      const atual = normalizar(l.pastaPronta);
      if (atual === 'nao') return { status: 'nao', linha: l.linha };
      if (atual === 'sim') return { status: 'ja-estava', linha: l.linha };

      const opcoes = await this.api.opcoesDaLista(`${letra(mapa.pasta)}${l.linha}`);
      const sim = opcoes.find((o) => normalizar(o) === 'sim') ?? 'Sim';
      await this.gravarConferindo(cliente, mapa, l.linha, mapa.pasta, l.pastaPronta, sim);
      if (mapa.marcador !== undefined) await this.pintarConferindo(cliente, mapa, l.linha, mapa.marcador);
      if (mapa.obs !== undefined) {
        const obs = l.observacoes.trim() ? `${l.observacoes.trim()} | ${anotacao}` : anotacao;
        await this.gravarConferindo(cliente, mapa, l.linha, mapa.obs, l.observacoes, obs);
      }
      return { status: 'marcado', linha: l.linha };
    });
  }

  /** Uma gravação por vez (várias pastas terminando juntas). */
  private exclusivo<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.fila.then(fn, fn);
    this.fila = p.catch(() => {});
    return p;
  }

  private async mapa(): Promise<Mapa> {
    return mapearCabecalho(await this.api.ler('A1:Z20'));
  }

  private paraLinha(n: number, c: string[], mapa: Mapa): LinhaPlanilha {
    const v = (i: number | undefined) => (i === undefined ? '' : String(c[i] ?? '').trim());
    return { linha: n, nome: v(mapa.nome), telefone: v(mapa.telefone), pastaPronta: v(mapa.pasta), observacoes: v(mapa.obs) };
  }

  private async linhas(mapa: Mapa): Promise<LinhaPlanilha[]> {
    const valores = await this.api.ler(`A${mapa.inicio}:${letra(mapa.ultima)}`);
    return valores.map((c, i) => this.paraLinha(mapa.inicio + i, c, mapa)).filter((l) => l.nome);
  }

  private async lerLinha(n: number, mapa: Mapa): Promise<LinhaPlanilha> {
    const [c] = await this.api.ler(`A${n}:${letra(mapa.ultima)}${n}`);
    return this.paraLinha(n, c ?? [], mapa);
  }

  private mesmaPessoa(l: LinhaPlanilha, cliente: { nome: string; telefone: string }): boolean {
    return grauNome(cliente.nome, l.nome) !== null && mesmoTelefone(l.telefone, cliente.telefone);
  }

  /** A linha atual do cliente por nome + telefone (a posição pode ter mudado desde a última leitura). */
  private async localizar(cliente: { nome: string; telefone: string }, mapa: Mapa): Promise<LinhaPlanilha> {
    const candidatos = (await this.linhas(mapa)).filter((l) => this.mesmaPessoa(l, cliente));
    if (candidatos.length === 1) return candidatos[0];
    if (candidatos.length > 1) {
      throw new ErroPlanilha(`${cliente.nome} aparece em ${candidatos.length} linhas da planilha com o mesmo telefone (${candidatos.map((l) => l.linha).join(', ')}). Deixe só uma e tente de novo.`);
    }
    throw new ErroPlanilha(`Não achei ${cliente.nome} com o telefone ${cliente.telefone} na planilha. A linha pode ter sido apagada ou editada.`);
  }

  /**
   * A linha do cliente andou (alguém inseriu ou apagou linhas). Se a gravação já tinha caído na linha dele,
   * ela andou junto: desfaz no lugar novo. Se não, o valor foi parar em outra linha: avisa qual conferir.
   */
  private async linhaAndou(
    cliente: { nome: string; telefone: string },
    mapa: Mapa,
    endereco: string,
    ocupante: LinhaPlanilha,
    caiuNoCliente: (agora: LinhaPlanilha) => Promise<boolean>,
    desfazer: (agora: LinhaPlanilha) => Promise<void>,
  ): Promise<never> {
    const agora = await this.localizar(cliente, mapa).catch(() => null);
    if (agora && (await caiuNoCliente(agora))) {
      await desfazer(agora).catch(() => {});
      throw new ErroPlanilha(`A linha de ${cliente.nome} mudou de lugar durante a gravação (agora é a ${agora.linha}). Desfiz; clique em Tentar de novo.`);
    }
    throw new ErroPlanilha(
      `A planilha mudou enquanto eu gravava: a alteração pode ter ido para ${endereco} (${ocupante.nome || 'linha vazia'}). Confira essa linha antes de tentar de novo.`,
    );
  }

  private async gravarConferindo(cliente: { nome: string; telefone: string }, mapa: Mapa, linha: number, coluna: number, antes: string, valor: string): Promise<void> {
    const celula = `${letra(coluna)}${linha}`;
    const ler = (l: LinhaPlanilha) => (coluna === mapa.pasta ? l.pastaPronta : l.observacoes);
    await this.api.gravar(celula, valor);
    const depois = await this.lerLinha(linha, mapa);
    if (!this.mesmaPessoa(depois, cliente)) {
      await this.linhaAndou(
        cliente,
        mapa,
        `a célula ${celula}`,
        depois,
        async (agora) => ler(agora) === valor.trim(),
        (agora) => this.api.gravar(`${letra(coluna)}${agora.linha}`, antes),
      );
    }
    if (ler(depois) !== valor.trim()) throw new ErroPlanilha(`Gravei ${celula}, mas a planilha mostra "${ler(depois)}". Confira a planilha.`);
  }

  private async pintarConferindo(cliente: { nome: string; telefone: string }, mapa: Mapa, linha: number, coluna: number): Promise<void> {
    const cores = await this.api.cores(coluna, mapa.inicio);
    const antes = cores[linha - mapa.inicio] ?? null;
    // o mesmo verde que as linhas prontas já usam
    const contagem = new Map<string, { cor: Cor; n: number }>();
    for (const c of cores) {
      if (!ehVerde(c)) continue;
      const k = JSON.stringify(c);
      contagem.set(k, { cor: c!, n: (contagem.get(k)?.n ?? 0) + 1 });
    }
    const verde = [...contagem.values()].sort((a, b) => b.n - a.n)[0]?.cor ?? { red: 0, green: 1, blue: 0 };
    await this.api.pintar(linha, coluna, verde);
    const depois = await this.lerLinha(linha, mapa);
    if (!this.mesmaPessoa(depois, cliente)) {
      const corDe = async (l: LinhaPlanilha) => (await this.api.cores(coluna, mapa.inicio))[l.linha - mapa.inicio];
      await this.linhaAndou(
        cliente,
        mapa,
        `a célula ${letra(coluna)}${linha}`,
        depois,
        async (agora) => JSON.stringify(await corDe(agora)) === JSON.stringify(verde) && JSON.stringify(antes) !== JSON.stringify(verde),
        (agora) => this.api.pintar(agora.linha, coluna, antes),
      );
    }
    const agora = (await this.api.cores(coluna, mapa.inicio))[linha - mapa.inicio];
    if (!ehVerde(agora)) throw new ErroPlanilha(`Pintei ${letra(coluna)}${linha} de verde, mas a planilha não mostra a cor. Confira a planilha.`);
  }
}

/** Aceita o link inteiro da planilha ou só o ID. */
export function idDaPlanilha(texto: string): string {
  const t = texto.trim();
  return /\/d\/([a-zA-Z0-9_-]+)/.exec(t)?.[1] ?? t;
}

/** A API do Google Sheets com a conta de serviço. */
export function apiGoogle(opcoes: { credenciais: object; planilhaId: string; aba: string }): ApiPlanilha {
  const auth = new authGoogle.GoogleAuth({ credentials: opcoes.credenciais, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const s = criarSheets({ version: 'v4', auth });
  const spreadsheetId = opcoes.planilhaId;
  const faixa = (intervalo: string) => `'${opcoes.aba.replace(/'/g, "''")}'!${intervalo}`;
  let idAba: number | undefined;

  const traduzir = (erro: unknown): never => {
    const e = erro as { code?: number; message?: string };
    if (e.code === 403) throw new ErroPlanilha('A conta de serviço não tem acesso à planilha. Compartilhe a planilha com o e-mail da conta (Ajustes) como Editor.');
    if (e.code === 404) throw new ErroPlanilha('Planilha não encontrada. Confira o link em Ajustes.');
    throw new ErroPlanilha(`Google Sheets: ${e.message ?? String(erro)}`);
  };
  const obterIdAba = async () => {
    if (idAba !== undefined) return idAba;
    const r = await s.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' }).catch(traduzir);
    const aba = r.data.sheets?.find((x) => x.properties?.title === opcoes.aba);
    if (aba?.properties?.sheetId == null) throw new ErroPlanilha(`A aba "${opcoes.aba}" não existe na planilha.`);
    idAba = aba.properties.sheetId;
    return idAba;
  };

  return {
    async titulo() {
      const r = await s.spreadsheets.get({ spreadsheetId, fields: 'properties.title' }).catch(traduzir);
      await obterIdAba();
      return r.data.properties?.title ?? '';
    },
    async ler(intervalo) {
      const r = await s.spreadsheets.values.get({ spreadsheetId, range: faixa(intervalo), valueRenderOption: 'FORMATTED_VALUE' }).catch(traduzir);
      return (r.data.values ?? []).map((linha) => linha.map((c) => String(c ?? '')));
    },
    async gravar(celula, valor) {
      await s.spreadsheets.values.update({ spreadsheetId, range: faixa(celula), valueInputOption: 'RAW', requestBody: { values: [[valor]] } }).catch(traduzir);
    },
    async cores(coluna, deLinha) {
      const l = letra(coluna);
      const r = await s.spreadsheets
        .get({ spreadsheetId, ranges: [faixa(`${l}${deLinha}:${l}`)], fields: 'sheets.data.rowData.values.userEnteredFormat.backgroundColor' })
        .catch(traduzir);
      return (r.data.sheets?.[0]?.data?.[0]?.rowData ?? []).map((row) => row.values?.[0]?.userEnteredFormat?.backgroundColor ?? undefined);
    },
    async pintar(linha, coluna, cor) {
      const sheetId = await obterIdAba();
      await s.spreadsheets
        .batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                repeatCell: {
                  range: { sheetId, startRowIndex: linha - 1, endRowIndex: linha, startColumnIndex: coluna, endColumnIndex: coluna + 1 },
                  cell: { userEnteredFormat: { backgroundColor: cor ?? { red: 1, green: 1, blue: 1 } } },
                  fields: 'userEnteredFormat.backgroundColor',
                },
              },
            ],
          },
        })
        .catch(traduzir);
    },
    async opcoesDaLista(celula) {
      const r = await s.spreadsheets.get({ spreadsheetId, ranges: [faixa(celula)], fields: 'sheets.data.rowData.values.dataValidation' }).catch(traduzir);
      const regra = r.data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.dataValidation?.condition;
      return regra?.type === 'ONE_OF_LIST' ? (regra.values ?? []).map((v) => v.userEnteredValue ?? '').filter(Boolean) : [];
    },
  };
}
