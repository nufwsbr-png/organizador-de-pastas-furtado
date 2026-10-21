import { ClientePlanilha, ErroPlanilha, idDaPlanilha, letra, mapearCabecalho, type ApiPlanilha, type Cor } from '../src/main/ferramentas/planilha';

/** Planilha em memória como a "Contratos/Entrevistas/Pastas": quadro de contagem em cima, cabeçalho na linha 7. */
class PlanilhaFalsa implements ApiPlanilha {
  linhas: string[][];
  cor = new Map<string, Cor>();
  gravacoes: string[] = [];
  /** Chamado depois de cada gravação: simula a equipe mexendo na planilha ao mesmo tempo. */
  depoisDeGravar?: (celula: string) => void;

  constructor(clientes: string[][], cabecalho = ['Data', 'Nome do cliente', 'Número de telefone', 'Entrevista agendada', 'Entrevista feita', 'Pasta pronta', 'Mês', 'Semana', 'Período da semana', 'Observações']) {
    this.linhas = [['Total', '259'], [], [], [], [], [], cabecalho, ...clientes];
  }

  private coordenada(celula: string): [number, number] {
    const m = /^([A-Z]+)(\d+)$/.exec(celula)!;
    const col = m[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    return [Number(m[2]), col];
  }

  async titulo() {
    return 'Contratos/Entrevistas/Pastas';
  }
  async ler(intervalo: string) {
    const [a, b] = intervalo.split(':');
    const [l1] = this.coordenada(/\d/.test(a) ? a : `${a}1`);
    const fim = /\d+$/.exec(b ?? '')?.[0];
    const l2 = fim ? Number(fim) : this.linhas.length;
    const r = this.linhas.slice(l1 - 1, l2).map((l) => [...l]);
    while (r.length > 0 && r[r.length - 1].length === 0) r.pop();
    return r;
  }
  async gravar(celula: string, valor: string) {
    const [l, c] = this.coordenada(celula);
    while (this.linhas.length < l) this.linhas.push([]);
    const linha = this.linhas[l - 1];
    while (linha.length <= c) linha.push('');
    linha[c] = valor;
    this.gravacoes.push(`${celula}=${valor}`);
    this.depoisDeGravar?.(celula);
  }
  async cores(coluna: number, deLinha: number) {
    return Array.from({ length: this.linhas.length - deLinha + 1 }, (_, i) => this.cor.get(`${coluna}:${deLinha + i}`));
  }
  async pintar(linha: number, coluna: number, cor: Cor | null) {
    if (cor) this.cor.set(`${coluna}:${linha}`, cor);
    else this.cor.delete(`${coluna}:${linha}`);
  }
  async opcoesDaLista() {
    return ['Sim', 'Não'];
  }
}

const VERDE_DA_EQUIPE = { red: 0.2, green: 0.8, blue: 0.3 };
const cliente = (nome: string, tel: string, pasta = '', obs = '') => ['15/10/2026', nome, tel, '', 'Sim', pasta, '', '', '', obs];

function planilhaPadrao() {
  const p = new PlanilhaFalsa([
    cliente('Ana Paula Ribeiro', '(31) 97654-3210', 'Sim', '14/10 Robô: Entrevista consta'),
    cliente('Lúcia Helena Araújo', '(31) 97654-3211', '', '15/10 Robô: Entrevista consta'),
    [],
    cliente('Maria Souza', '(51) 99999-1111'),
    cliente('Maria Souza', '(51) 98888-2222', 'Não'),
  ]);
  // linhas prontas já pintadas pela equipe
  p.cor.set(`${10}:8`, VERDE_DA_EQUIPE);
  return p;
}

describe('cabeçalho e utilidades', () => {
  it('acha as colunas pelo nome, mesmo se mudarem de lugar', () => {
    const m = mapearCabecalho([[], ['Telefone', 'Pasta pronta', 'Cliente (nome)', 'Observações']]);
    expect(m).toMatchObject({ cabecalho: 2, inicio: 3, telefone: 0, pasta: 1, nome: 2, obs: 3, marcador: 4 });
    expect(() => mapearCabecalho([['Data', 'Valor']])).toThrow(ErroPlanilha);
  });
  it('letras de coluna e ID da planilha pelo link', () => {
    expect([letra(0), letra(5), letra(10), letra(26)]).toEqual(['A', 'F', 'K', 'AA']);
    expect(idDaPlanilha('https://docs.google.com/spreadsheets/d/17KlJ2U_abc-XYZ/edit?gid=1')).toBe('17KlJ2U_abc-XYZ');
    expect(idDaPlanilha(' 17KlJ2U ')).toBe('17KlJ2U');
  });
});

describe('ClientePlanilha', () => {
  it('testar diz quantos clientes e quais colunas', async () => {
    expect(await new ClientePlanilha(planilhaPadrao()).testar()).toBe(
      'Planilha "Contratos/Entrevistas/Pastas": 4 cliente(s); colunas nome B, telefone C, Pasta pronta F, Observações J.',
    );
  });

  it('procura por nome com ou sem acento e devolve as linhas certas', async () => {
    const p = new ClientePlanilha(planilhaPadrao());
    const r = await p.procurarPorNome('LUCIA HELENA ARAUJO');
    expect(r.map((l) => [l.linha, l.grau, l.telefone])).toEqual([[9, 'igual', '(31) 97654-3211']]);
    expect((await p.procurarPorNome('Maria Souza')).map((l) => l.linha)).toEqual([11, 12]);
  });

  it('marca Sim (valor da lista), pinta o marcador com o verde da equipe e acrescenta a anotação', async () => {
    const api = planilhaPadrao();
    const r = await new ClientePlanilha(api).marcarPastaPronta({ nome: 'Lúcia Helena Araújo', telefone: '31976543211' }, '21/10 Robô: pasta organizada pelo app');
    expect(r).toEqual({ status: 'marcado', linha: 9 });
    expect(api.linhas[8][5]).toBe('Sim');
    expect(api.linhas[8][9]).toBe('15/10 Robô: Entrevista consta | 21/10 Robô: pasta organizada pelo app');
    expect(api.cor.get('10:9')).toEqual(VERDE_DA_EQUIPE);
    expect(api.gravacoes).toEqual(['F9=Sim', 'J9=15/10 Robô: Entrevista consta | 21/10 Robô: pasta organizada pelo app']);
  });

  it('não mexe quando a equipe marcou Não, nem quando já está Sim', async () => {
    const api = planilhaPadrao();
    const p = new ClientePlanilha(api);
    expect(await p.marcarPastaPronta({ nome: 'Maria Souza', telefone: '(51) 98888-2222' }, 'x')).toEqual({ status: 'nao', linha: 12 });
    expect(await p.marcarPastaPronta({ nome: 'Ana Paula Ribeiro', telefone: '31976543210' }, 'x')).toEqual({ status: 'ja-estava', linha: 8 });
    expect(api.gravacoes).toEqual([]);
  });

  it('nome repetido: escolhe a linha pelo telefone', async () => {
    const api = planilhaPadrao();
    expect(await new ClientePlanilha(api).marcarPastaPronta({ nome: 'Maria Souza', telefone: '5551999991111' }, 'x')).toEqual({ status: 'marcado', linha: 11 });
    expect(api.linhas[10][5]).toBe('Sim');
  });

  it('cliente que não está na planilha com esse telefone: erro claro, nada gravado', async () => {
    const api = planilhaPadrao();
    await expect(new ClientePlanilha(api).marcarPastaPronta({ nome: 'Lúcia Helena Araújo', telefone: '11999990000' }, 'x')).rejects.toThrow(/Não achei Lúcia/);
    expect(api.gravacoes).toEqual([]);
  });

  it('alguém insere uma linha logo depois da gravação: desfaz na linha nova do cliente, sem tocar no outro', async () => {
    const api = planilhaPadrao();
    api.depoisDeGravar = (celula) => {
      if (celula === 'F9') {
        api.depoisDeGravar = undefined;
        api.linhas.splice(8, 0, cliente('Novo Cliente Inserido', '(11) 91111-1111', 'Sim'));
      }
    };
    await expect(new ClientePlanilha(api).marcarPastaPronta({ nome: 'Lúcia Helena Araújo', telefone: '31976543211' }, 'x')).rejects.toThrow(
      /mudou de lugar durante a gravação \(agora é a 10\)\. Desfiz/,
    );
    expect(api.gravacoes).toEqual(['F9=Sim', 'F10=']);
    expect(api.linhas[8].slice(1, 6)).toEqual(['Novo Cliente Inserido', '(11) 91111-1111', '', 'Sim', 'Sim']);
    expect(api.linhas[9][5]).toBe('');
  });

  it('a linha anda antes da gravação: não adivinha, avisa qual linha conferir', async () => {
    const api = planilhaPadrao();
    const gravar = api.gravar.bind(api);
    api.gravar = async (celula, valor) => {
      if (celula === 'F9' && valor === 'Sim') api.linhas.splice(8, 0, cliente('Novo Cliente Inserido', '(11) 91111-1111'));
      return gravar(celula, valor);
    };
    await expect(new ClientePlanilha(api).marcarPastaPronta({ nome: 'Lúcia Helena Araújo', telefone: '31976543211' }, 'x')).rejects.toThrow(
      /pode ter ido para a célula F9 \(Novo Cliente Inserido\)\. Confira essa linha/,
    );
    expect(api.gravacoes).toEqual(['F9=Sim']);
  });
});
