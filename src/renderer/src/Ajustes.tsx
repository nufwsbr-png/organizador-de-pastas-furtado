import { useState, type ReactNode } from 'react';
import { api, type Ajustes as AjustesApp, type EstadoApp } from './api';
import { Simbolo } from './Simbolo';

const NOME_TEMA: Record<AjustesApp['tema'], string> = { sistema: 'Igual ao Windows', claro: 'Claro', escuro: 'Noturno' };
type ServicoTranscricao = AjustesApp['transcricao'];
const NOME_SERVICO: Record<ServicoTranscricao, string> = { elevenlabs: 'ElevenLabs', openrouter: 'OpenRouter' };
/** Modelos do OpenRouter, com o que se viu na ligação de 18 min usada no teste (22/10/2026). */
const MODELOS: Record<AjustesApp['modeloOpenRouter'], { nome: string; nota: string }> = {
  'mistralai/voxtral-mini-transcribe': { nome: 'Voxtral', nota: 'o mais fiel, com a hora de cada fala e sem frases inventadas (cerca de US$ 0,025 por ligação de 18 min)' },
  'openai/whisper-large-v3-turbo': { nome: 'Whisper', nota: 'o mais barato (cerca de US$ 0,002 por ligação), mas inventa "Obrigado." e "Tchau." nas pausas' },
  'openai/gpt-4o-mini-transcribe': { nome: 'GPT-4o mini', nota: 'texto limpo, mas em blocos, sem a hora de cada fala (cerca de US$ 0,018 por ligação)' },
};

interface Props {
  estado: EstadoApp;
  aoVoltar: () => void;
  aoMudar: () => Promise<unknown>;
}

interface PropsSegredo {
  titulo: string;
  /** Aparece logo abaixo do título (ex.: seletor do serviço). */
  cabecalho?: ReactNode;
  children: ReactNode;
  /** Valor atual mascarado (ou null se não há). */
  atual: string | null;
  placeholder: string;
  salvar: (valor: string) => Promise<unknown>;
  testar: () => Promise<{ ok: boolean; mensagem: string }>;
  aoMudar: () => Promise<unknown>;
}

/** Executa uma ação de Ajustes mostrando o resultado (ou o erro) embaixo da seção. */
function useAcao() {
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
  return { resultado, ocupado, agir };
}

/** Chave/token guardado no .env do app: colar, testar e apagar. */
function Segredo({ titulo, cabecalho, children, atual, placeholder, salvar, testar, aoMudar }: PropsSegredo) {
  const [valor, setValor] = useState('');
  const { resultado, ocupado, agir } = useAcao();

  return (
    <section>
      <h2>{titulo}</h2>
      {cabecalho}
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

/** WAHA: endereço, sessão do WhatsApp do escritório e chave da API. */
function SecaoWhatsapp({ estado, aoMudar }: Omit<Props, 'aoVoltar'>) {
  const [url, setUrl] = useState(estado.ajustes.wahaUrl);
  const [sessao, setSessao] = useState(estado.ajustes.wahaSessao);
  const [chave, setChave] = useState('');
  const { resultado, ocupado, agir } = useAcao();

  return (
    <section>
      <h2>WhatsApp (WAHA)</h2>
      <p className="sub">
        Conversas do WhatsApp do escritório. O app só lê: acha a conversa pelo telefone da planilha e baixa as fotos e os documentos que o cliente mandou.
        Chave atual: {estado.chaveWaha ?? 'nenhuma'}.
      </p>
      <div className="linha">
        <input placeholder="https://pastas.nufws.com.br" value={url} onChange={(e) => setUrl(e.target.value)} />
        <input className="campo-curto" placeholder="Sessão" value={sessao} onChange={(e) => setSessao(e.target.value)} />
      </div>
      <div className="linha">
        <input type="password" placeholder={estado.chaveWaha ? 'Nova chave da API (deixe vazio para manter)' : 'Chave da API do WAHA'} value={chave} onChange={(e) => setChave(e.target.value)} />
        <button
          className="primario"
          disabled={ocupado}
          onClick={() =>
            agir(async () => {
              await api.ajustes.definir({ wahaUrl: url.trim().replace(/\/+$/, ''), wahaSessao: sessao.trim() || 'furtado' });
              if (chave.trim()) await api.ajustes.chaveWaha(chave);
              setChave('');
              await aoMudar();
              return (await api.ajustes.testarWaha()).mensagem;
            })
          }
        >
          Salvar
        </button>
        <button disabled={ocupado || !estado.ajustes.wahaUrl} onClick={() => agir(async () => (await api.ajustes.testarWaha()).mensagem)}>
          Testar
        </button>
      </div>
      {resultado && <p className="detalhe-texto">{resultado}</p>}
    </section>
  );
}

/** Planilha Contratos/Entrevistas/Pastas: conta de serviço do Google, link e aba. */
function SecaoPlanilha({ estado, aoMudar }: Omit<Props, 'aoVoltar'>) {
  const [id, setId] = useState(estado.ajustes.planilhaId);
  const [aba, setAba] = useState(estado.ajustes.planilhaAba);
  const { resultado, ocupado, agir } = useAcao();

  return (
    <section>
      <h2>Planilha</h2>
      <p className="sub">
        Com ela o app confirma nome e telefone do cliente e, com a pasta pronta, marca "Pasta pronta" = Sim, pinta o marcador de verde e anota em Observações.
      </p>
      <div className="linha">
        <button
          disabled={ocupado}
          onClick={() =>
            agir(async () => {
              const email = await api.ajustes.contaServico();
              await aoMudar();
              return email ? `Conta de serviço: ${email}. Compartilhe a planilha com esse e-mail como Editor.` : 'Nenhum arquivo escolhido.';
            })
          }
        >
          {estado.contaServico ? 'Trocar o arquivo da conta de serviço' : 'Escolher o arquivo da conta de serviço (JSON)'}
        </button>
        {estado.contaServico && <span className="sub">{estado.contaServico}</span>}
      </div>
      <div className="linha">
        <input placeholder="Link da planilha no Google Sheets" value={id} onChange={(e) => setId(e.target.value)} />
        <input className="campo-curto" placeholder="Aba" value={aba} onChange={(e) => setAba(e.target.value)} />
        <button
          className="primario"
          disabled={ocupado}
          onClick={() =>
            agir(async () => {
              await api.ajustes.definir({ planilhaId: id.trim(), planilhaAba: aba.trim() || 'Lançamentos' });
              await aoMudar();
              return (await api.ajustes.testarPlanilha()).mensagem;
            })
          }
        >
          Salvar
        </button>
        <button disabled={ocupado || !estado.ajustes.planilhaId} onClick={() => agir(async () => (await api.ajustes.testarPlanilha()).mensagem)}>
          Testar
        </button>
      </div>
      {resultado && <p className="detalhe-texto">{resultado}</p>}
    </section>
  );
}

export function Ajustes({ estado, aoVoltar, aoMudar }: Props) {
  const a = estado.atualizacao;
  const servico = estado.ajustes.transcricao;
  const modelo = estado.ajustes.modeloOpenRouter;

  return (
    <div className="tela-ajustes">
      <header className="barra">
        <div className="marca">
          <Simbolo />
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

        <SecaoWhatsapp estado={estado} aoMudar={aoMudar} />
        <SecaoPlanilha estado={estado} aoMudar={aoMudar} />

        <Segredo
          key={servico}
          titulo="Transcrição"
          cabecalho={
            <>
              <div className="linha">
                <div className="segmentos" role="radiogroup" aria-label="Serviço de transcrição">
                  {(Object.keys(NOME_SERVICO) as ServicoTranscricao[]).map((s) => (
                    <button key={s} role="radio" aria-checked={servico === s} className={servico === s ? 'escolhido' : ''} onClick={() => api.ajustes.definir({ transcricao: s }).then(aoMudar)}>
                      {NOME_SERVICO[s]}
                    </button>
                  ))}
                </div>
              </div>
              {servico === 'openrouter' && (
                <div className="linha">
                  <span className="sub">Modelo</span>
                  <div className="segmentos" role="radiogroup" aria-label="Modelo do OpenRouter">
                    {(Object.keys(MODELOS) as AjustesApp['modeloOpenRouter'][]).map((m) => (
                      <button key={m} role="radio" aria-checked={modelo === m} title={m} className={modelo === m ? 'escolhido' : ''} onClick={() => api.ajustes.definir({ modeloOpenRouter: m }).then(aoMudar)}>
                        {MODELOS[m].nome}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          }
          atual={servico === 'openrouter' ? estado.chaveOpenRouter : estado.chaveElevenLabs}
          placeholder={`Cole a chave da API do ${NOME_SERVICO[servico]}`}
          salvar={servico === 'openrouter' ? api.ajustes.chaveOpenRouter : api.ajustes.chave}
          testar={servico === 'openrouter' ? api.ajustes.testarOpenRouter : api.ajustes.testarChave}
          aoMudar={aoMudar}
        >
          {servico === 'openrouter' ? (
            <>
              Chave da API do OpenRouter. Modelo <code>{modelo}</code>: {MODELOS[modelo].nota}. Nenhum modelo do OpenRouter separa quem fala.
            </>
          ) : (
            <>Chave da API do ElevenLabs (Scribe). Transcreve o áudio da ligação separando quem fala (Falante 1, Falante 2).</>
          )}{' '}
          Fica em <code>{estado.arquivoEnv}</code>.
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
          <h2>Aparência</h2>
          <p className="sub">Modo claro, noturno ou o mesmo do Windows. O sol/lua da barra também alterna.</p>
          <div className="linha">
            <div className="segmentos" role="radiogroup" aria-label="Tema">
              {(Object.keys(NOME_TEMA) as AjustesApp['tema'][]).map((t) => (
                <button key={t} role="radio" aria-checked={estado.ajustes.tema === t} className={estado.ajustes.tema === t ? 'escolhido' : ''} onClick={() => api.ajustes.definir({ tema: t }).then(aoMudar)}>
                  {NOME_TEMA[t]}
                </button>
              ))}
            </div>
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
