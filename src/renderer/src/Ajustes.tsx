import { useState, type ReactNode } from 'react';
import simbolo from './assets/simbolo.svg';
import { api, type EstadoApp } from './api';

interface Props {
  estado: EstadoApp;
  aoVoltar: () => void;
  aoMudar: () => Promise<unknown>;
}

interface PropsSegredo {
  titulo: string;
  children: ReactNode;
  /** Valor atual mascarado (ou null se não há). */
  atual: string | null;
  placeholder: string;
  salvar: (valor: string) => Promise<unknown>;
  testar: () => Promise<{ ok: boolean; mensagem: string }>;
  aoMudar: () => Promise<unknown>;
}

/** Chave/token guardado no .env do app: colar, testar e apagar. */
function Segredo({ titulo, children, atual, placeholder, salvar, testar, aoMudar }: PropsSegredo) {
  const [valor, setValor] = useState('');
  const [resultado, setResultado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const agir = async (acao: () => Promise<string>) => {
    setOcupado(true);
    try {
      setResultado(await acao());
    } catch (e) {
      setResultado(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section>
      <h2>{titulo}</h2>
      <p className="sub">
        {children} {atual ? `Atual: ${atual}` : 'Nada salvo ainda.'}
      </p>
      <div className="linha">
        <input type="password" placeholder={placeholder} value={valor} onChange={(e) => setValor(e.target.value)} />
        <button
          className="primario"
          disabled={ocupado || !valor.trim()}
          onClick={() =>
            agir(async () => {
              await salvar(valor);
              setValor('');
              await aoMudar();
              return (await testar()).mensagem;
            })
          }
        >
          Salvar
        </button>
        <button disabled={ocupado || !atual} onClick={() => agir(async () => (await testar()).mensagem)}>
          Testar
        </button>
        {atual && (
          <button
            className="discreto perigo"
            disabled={ocupado}
            onClick={() =>
              agir(async () => {
                await salvar('');
                await aoMudar();
                return 'Apagado.';
              })
            }
          >
            Apagar
          </button>
        )}
      </div>
      {resultado && <p className="detalhe-texto">{resultado}</p>}
    </section>
  );
}

export function Ajustes({ estado, aoVoltar, aoMudar }: Props) {
  const a = estado.atualizacao;

  return (
    <div className="tela-ajustes">
      <header className="barra">
        <div className="marca">
          <img className="simbolo" src={simbolo} alt="" />
          <h1>Ajustes</h1>
        </div>
        <button onClick={aoVoltar}>← Voltar</button>
      </header>
      <div className="linha-grad" />

      <div className="conteudo">
        <Segredo
          titulo="ZapSign"
          atual={estado.tokenZapsign}
          placeholder="Cole o token da API do ZapSign"
          salvar={api.ajustes.tokenZapsign}
          testar={api.ajustes.testarZapsign}
          aoMudar={aoMudar}
        >
          Token da API do ZapSign (a conta precisa do Plano de API). Com ele o app puxa a procuração, a declaração e o contrato assinados do cliente e guarda em
          Contratos e Não juntar. Fica em <code>{estado.arquivoEnv}</code>.
        </Segredo>

        <Segredo
          titulo="Transcrição (ElevenLabs)"
          atual={estado.chaveElevenLabs}
          placeholder="Cole a chave da API do ElevenLabs"
          salvar={api.ajustes.chave}
          testar={api.ajustes.testarChave}
          aoMudar={aoMudar}
        >
          Chave da API do ElevenLabs, usada para transcrever o áudio da ligação. Fica em <code>{estado.arquivoEnv}</code>.
        </Segredo>

        <section>
          <h2>Inteligência artificial</h2>
          <p className="sub">
            Provedor atual: {estado.ajustes.provedor === 'claude' ? 'Claude' : estado.ajustes.provedor === 'codex' ? 'ChatGPT (Codex)' : 'nenhum'}. Para trocar, use o botão Login na tela principal.
          </p>
          <div className="linha">
            <label>
              Pastas organizadas ao mesmo tempo:
              <select value={estado.ajustes.paralelismo} onChange={(e) => api.ajustes.definir({ paralelismo: Number(e.target.value) }).then(aoMudar)}>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section>
          <h2>Atualizações</h2>
          <p className="sub">Versão instalada: {estado.versao}</p>
          <div className="linha">
            <button className="primario" disabled={a.estado === 'verificando' || a.estado === 'baixando' || a.estado === 'dev'} onClick={() => api.atualizacao.buscar()}>
              Buscar atualizações
            </button>
            {a.estado === 'pronta' && (
              <button className="primario" onClick={() => api.atualizacao.instalar()}>
                Reiniciar e instalar {a.versao}
              </button>
            )}
          </div>
          <p className="detalhe-texto">
            {a.estado === 'dev' && 'Atualização automática só funciona no app instalado.'}
            {a.estado === 'verificando' && 'Verificando no GitHub…'}
            {a.estado === 'atualizado' && 'Você já está na versão mais recente.'}
            {a.estado === 'disponivel' && `Nova versão ${a.versao} encontrada; baixando em segundo plano…`}
            {a.estado === 'baixando' && `Baixando… ${a.porcento}%`}
            {a.estado === 'pronta' && `Versão ${a.versao} baixada. Reinicie para instalar.`}
            {a.estado === 'erro' && `Erro ao buscar atualizações: ${a.mensagem}`}
          </p>
        </section>

        <section>
          <h2>Diagnóstico</h2>
          <div className="linha">
            <button onClick={() => api.ajustes.abrirLogs()}>Abrir pasta de dados e logs</button>
          </div>
        </section>
      </div>
    </div>
  );
}
