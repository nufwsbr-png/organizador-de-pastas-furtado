import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type EstadoApp, type Job } from './api';
import { Simbolo } from './Simbolo';
import { BotaoTema } from './Tema';

interface Props {
  estado: EstadoApp;
  aoAjustes: () => void;
  aoTrocarLogin: () => void;
  aoMudar: () => Promise<unknown>;
}

const ETAPAS = ['inventario', 'perguntas', 'zapsign', 'cliente', 'whatsapp', 'transcricao', 'respostas', 'pdf-entrevista', 'classificar', 'mover', 'entregar-entrevista', 'planilha'];
const NOME_ETAPA: Record<string, string> = {
  inventario: 'Lendo a pasta',
  perguntas: 'Lendo a entrevista',
  zapsign: 'Buscando no ZapSign',
  cliente: 'Confirmando o cliente',
  whatsapp: 'Buscando no WhatsApp',
  transcricao: 'Transcrevendo a ligação',
  respostas: 'Respondendo a entrevista',
  'pdf-entrevista': 'Gerando o PDF da entrevista',
  classificar: 'Identificando os documentos',
  mover: 'Arrumando as pastas',
  'entregar-entrevista': 'Salvando a entrevista',
  planilha: 'Marcando na planilha',
};
const NOME_ESTADO: Record<Job['estado'], string> = {
  'na-fila': 'Na fila',
  aguardando: 'Na vez',
  rodando: 'Organizando',
  pausado: 'Pausado',
  atencao: 'Atenção',
  concluido: 'Concluído',
  erro: 'Erro',
};

/** Grupos da lista, na ordem em que aparecem. */
const GRUPOS: { id: string; titulo: string; estados: Job['estado'][] }[] = [
  { id: 'agora', titulo: 'Organizando agora', estados: ['rodando', 'aguardando'] },
  { id: 'fila', titulo: 'Para organizar', estados: ['na-fila'] },
  { id: 'voce', titulo: 'Precisam de você', estados: ['atencao', 'pausado', 'erro'] },
  { id: 'concluidas', titulo: 'Concluídas', estados: ['concluido'] },
];

function progresso(job: Job): number {
  if (job.estado === 'concluido') return 100;
  const feitas = job.etapasConcluidas.length + job.etapasPendentes.length;
  return Math.round((feitas / ETAPAS.length) * 100);
}

function linhaDoJob(j: Job): string {
  if (j.estado === 'rodando') return j.etapa ? NOME_ETAPA[j.etapa] ?? j.etapa : 'Começando…';
  if (j.estado === 'aguardando') return 'Esperando uma vaga para começar';
  if (j.estado === 'na-fila') return 'Clique em Organizar para começar';
  if (j.estado === 'concluido') return `Concluída ${quando(j.atualizadoEm)}`;
  return j.motivo ?? '';
}

function quando(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return hoje ? `hoje às ${hora}` : `em ${d.toLocaleDateString('pt-BR')} às ${hora}`;
}

export function Principal({ estado, aoAjustes, aoTrocarLogin, aoMudar }: Props) {
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [verConcluidas, setVerConcluidas] = useState(true);
  const [buscaZapsign, setBuscaZapsign] = useState('');
  const [nomeCliente, setNomeCliente] = useState('');
  const [telefoneCliente, setTelefoneCliente] = useState('');
  const jobs = estado.jobs;

  const grupos = useMemo(
    () =>
      GRUPOS.map((g) => ({
        ...g,
        jobs: jobs
          .filter((j) => g.estados.includes(j.estado))
          .sort((a, b) => (g.id === 'concluidas' ? b.atualizadoEm.localeCompare(a.atualizadoEm) : g.estados.indexOf(a.estado) - g.estados.indexOf(b.estado))),
      })),
    [jobs],
  );
  const job = useMemo(() => jobs.find((j) => j.id === selecionado) ?? grupos.flatMap((g) => g.jobs)[0] ?? null, [jobs, grupos, selecionado]);
  const fimDoChat = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fimDoChat.current?.scrollIntoView({ block: 'end' });
  }, [job?.id, job?.mensagens.length]);

  useEffect(() => {
    setBuscaZapsign(job?.buscaZapsign ?? '');
    setNomeCliente(job?.cliente?.nome ?? '');
    setTelefoneCliente(job?.cliente?.telefone ?? '');
  }, [job?.id]);

  const tentar = async (acao: () => Promise<unknown>) => {
    setErro(null);
    try {
      await acao();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  };

  const ocupado = (j: Job) => j.estado === 'rodando' || j.estado === 'aguardando';
  const prontosParaOrganizar = jobs.filter((j) => !ocupado(j) && j.estado !== 'concluido').length;
  const organizandoAgora = jobs.filter((j) => j.estado === 'rodando').length;
  const zapsignPendente = job !== null && !ocupado(job) && job.etapasPendentes.includes('zapsign');
  const wahaPronto = Boolean(estado.ajustes.wahaUrl && estado.chaveWaha);
  const planilhaPronta = Boolean(estado.contaServico && estado.ajustes.planilhaId);
  // cliente não confirmado na planilha, ou conversa não achada com o telefone dela
  const dadosPendentes =
    job !== null && !ocupado(job) && planilhaPronta && (job.etapasPendentes.includes('cliente') || (wahaPronto && job.etapasPendentes.includes('whatsapp')));
  const transcricao = estado.ajustes.transcricao === 'openrouter' ? { nome: 'OpenRouter', chave: estado.chaveOpenRouter } : { nome: 'ElevenLabs', chave: estado.chaveElevenLabs };
  const indicadores = [
    { nome: 'ZapSign', ok: Boolean(estado.tokenZapsign), falta: 'Sem token do ZapSign: os assinados não serão puxados' },
    { nome: 'WhatsApp', ok: wahaPronto, falta: 'Sem WAHA: os documentos do WhatsApp não serão puxados' },
    { nome: 'Planilha', ok: planilhaPronta, falta: 'Sem planilha: o cliente não é confirmado nem marcado como Pasta pronta' },
    { nome: transcricao.nome, ok: Boolean(transcricao.chave), falta: `Sem chave do ${transcricao.nome}: o áudio da ligação não é transcrito` },
  ];

  return (
    <div className="tela-principal">
      <header className="barra">
        <div className="marca">
          <Simbolo />
          <div>
            <h1>Organizador de pastas</h1>
            <div className="marca-sub">
              <span title="Inteligência artificial em uso">{estado.ajustes.provedor === 'claude' ? 'Claude' : 'ChatGPT'}</span>
              {indicadores.map((i) => (
                <span key={i.nome} title={i.ok ? `${i.nome} configurado` : i.falta}>
                  <i className={`ponto ${i.ok ? 'ponto-ok' : 'ponto-falta'}`} />
                  {i.nome}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="acoes">
          <button onClick={() => tentar(() => api.pastas.escolher())}>Enviar pasta</button>
          <button className="primario" disabled={prontosParaOrganizar === 0} onClick={() => tentar(() => api.jobs.organizar())}>
            Organizar pasta{prontosParaOrganizar > 1 ? `s (${prontosParaOrganizar})` : ''}
            <span className="seta">→</span>
          </button>
          <button className="discreto" onClick={aoTrocarLogin} title="Trocar Claude/ChatGPT">
            Login
          </button>
          <button className="discreto" onClick={aoAjustes} title="Ajustes">
            Ajustes
          </button>
          <BotaoTema aoMudar={aoMudar} />
        </div>
      </header>
      <div className="linha-grad" />

      {erro && <p className="erro">{erro}</p>}

      {jobs.length === 0 ? (
        <div className="vazio">
          <Simbolo />
          <h2>Nenhuma pasta ainda.</h2>
          <p>
            Clique em <b>Enviar pasta</b> e escolha a pasta de um ou mais clientes. Depois, <b>Organizar pasta</b>: até {estado.ajustes.paralelismo} pastas são
            organizadas ao mesmo tempo.
          </p>
        </div>
      ) : (
        <div className="colunas">
          <nav className="lista-jobs">
            {grupos.map((g) => {
              if (g.jobs.length === 0 && g.id !== 'agora') return null;
              const recolhido = g.id === 'concluidas' && !verConcluidas;
              return (
                <section key={g.id} className="grupo">
                  <div className="grupo-cabecalho">
                    <span className="rotulo">
                      {g.titulo} <span className="contagem">{g.jobs.length}</span>
                    </span>
                    {g.id === 'agora' && (
                      <span className="grupo-nota" title="Pastas organizadas ao mesmo tempo (muda em Ajustes)">
                        {organizandoAgora} de {estado.ajustes.paralelismo} vagas
                      </span>
                    )}
                    {g.id === 'concluidas' && (
                      <span>
                        <button className="discreto pequeno" onClick={() => setVerConcluidas(!verConcluidas)}>
                          {verConcluidas ? 'Esconder' : 'Mostrar'}
                        </button>
                        <button className="discreto pequeno" onClick={() => tentar(() => api.jobs.limparConcluidas())} title="Tira as concluídas da lista (não mexe nos arquivos)">
                          Limpar
                        </button>
                      </span>
                    )}
                  </div>
                  {g.id === 'agora' && g.jobs.length === 0 && <p className="grupo-vazio">Nenhuma pasta sendo organizada.</p>}
                  {!recolhido && (
                    <ul>
                      {g.jobs.map((j) => (
                        <li key={j.id} className={`job job-${j.estado} ${job?.id === j.id ? 'job-selecionado' : ''}`} onClick={() => setSelecionado(j.id)}>
                          <div className="job-linha">
                            <span className="job-nome" title={j.pasta}>
                              {j.nome}
                            </span>
                            <span className={`etiqueta etiqueta-${j.estado}`}>{NOME_ESTADO[j.estado]}</span>
                          </div>
                          {j.estado !== 'concluido' && (
                            <div className="barra-progresso">
                              <div style={{ width: `${progresso(j)}%` }} />
                            </div>
                          )}
                          <div className="job-etapa">{linhaDoJob(j)}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </nav>

          {job && (
            <section className="detalhe">
              <div className="detalhe-cabecalho">
                <div className="detalhe-topo">
                  <span className="rotulo eyebrow">{NOME_ESTADO[job.estado]}</span>
                  <div className="acoes">
                    <button onClick={() => tentar(() => api.jobs.abrirPasta(job.pasta))}>Abrir pasta</button>
                    {!ocupado(job) && job.estado !== 'concluido' && (
                      <button className="primario" onClick={() => tentar(() => api.jobs.organizar(job.id))}>
                        {job.estado === 'na-fila' ? 'Organizar' : 'Tentar de novo'}
                      </button>
                    )}
                    {!ocupado(job) && (
                      <button className="discreto" onClick={() => tentar(() => api.jobs.refazer(job.id))} title="Apaga o que foi feito (menos a transcrição) e organiza de novo">
                        Refazer
                      </button>
                    )}
                    {!ocupado(job) && (
                      <button className="discreto perigo" onClick={() => tentar(() => api.jobs.remover(job.id))} title="Tira da lista (não mexe nos arquivos)">
                        Remover da lista
                      </button>
                    )}
                  </div>
                </div>
                <h2>{job.nome}</h2>
                <span className="caminho">{job.pasta}</span>
              </div>
              {job.motivo && <p className={`motivo motivo-${job.estado}`}>{job.motivo}</p>}
              {dadosPendentes && (
                <div className="caixa-busca">
                  <span className="mini">Dados do cliente</span>
                  <p className="sub">Nome e telefone como estão na planilha. O telefone é o do WhatsApp do cliente.</p>
                  <div className="linha">
                    <input placeholder={job.nome} value={nomeCliente} onChange={(e) => setNomeCliente(e.target.value)} />
                    <input className="campo-telefone" placeholder="(DD) 99999-9999" value={telefoneCliente} onChange={(e) => setTelefoneCliente(e.target.value)} />
                    <button className="primario" onClick={() => tentar(() => api.jobs.dadosCliente(job.id, { nome: nomeCliente, telefone: telefoneCliente }))}>
                      Buscar de novo
                    </button>
                  </div>
                </div>
              )}
              {zapsignPendente && estado.tokenZapsign && (
                <div className="caixa-busca">
                  <span className="mini">Buscar no ZapSign</span>
                  <p className="sub">Se o cliente está no ZapSign com outro nome, informe o nome como está lá, o e-mail dele ou o link do documento.</p>
                  <div className="linha">
                    <input placeholder={job.nome} value={buscaZapsign} onChange={(e) => setBuscaZapsign(e.target.value)} />
                    <button className="primario" onClick={() => tentar(() => api.jobs.buscaZapsign(job.id, buscaZapsign))}>
                      Buscar de novo
                    </button>
                  </div>
                </div>
              )}
              <ol className="etapas">
                {ETAPAS.map((e) => {
                  const classe = job.etapasConcluidas.includes(e) ? 'feita' : job.etapasPendentes.includes(e) ? 'pendente' : job.etapa === e && job.estado === 'rodando' ? 'atual' : '';
                  return (
                    <li key={e} className={classe}>
                      {NOME_ETAPA[e]}
                    </li>
                  );
                })}
              </ol>
              <div className="chat">
                {job.mensagens.length === 0 && <p className="sub">Ainda não começou.</p>}
                {job.mensagens.map((m, i) => (
                  <div key={i} className={`msg msg-${m.nivel}`}>
                    <span className="hora">{new Date(m.quando).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span>{m.texto}</span>
                  </div>
                ))}
                <div ref={fimDoChat} />
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
