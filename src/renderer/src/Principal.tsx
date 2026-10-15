import { useEffect, useMemo, useRef, useState } from 'react';
import simbolo from './assets/simbolo.svg';
import { api, type EstadoApp, type Job } from './api';

interface Props {
  estado: EstadoApp;
  aoAjustes: () => void;
  aoTrocarLogin: () => void;
}

const ETAPAS = ['inventario', 'transcricao', 'perguntas', 'respostas', 'pdf-entrevista', 'classificar', 'mover', 'entregar-entrevista'];
const NOME_ETAPA: Record<string, string> = {
  inventario: 'Lendo a pasta',
  transcricao: 'Transcrevendo a ligação',
  perguntas: 'Lendo as perguntas',
  respostas: 'Respondendo a entrevista',
  'pdf-entrevista': 'Gerando o PDF da entrevista',
  classificar: 'Identificando os documentos',
  mover: 'Arrumando as pastas',
  'entregar-entrevista': 'Salvando a entrevista',
};
const NOME_ESTADO: Record<Job['estado'], string> = {
  'na-fila': 'Na fila',
  rodando: 'Organizando',
  pausado: 'Pausado',
  atencao: 'Atenção',
  concluido: 'Concluído',
  erro: 'Erro',
};

function progresso(job: Job): number {
  if (job.estado === 'concluido') return 100;
  const feitas = job.etapasConcluidas.length + job.etapasPendentes.length;
  return Math.round((feitas / ETAPAS.length) * 100);
}

export function Principal({ estado, aoAjustes, aoTrocarLogin }: Props) {
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const jobs = estado.jobs;
  const job = useMemo(() => jobs.find((j) => j.id === selecionado) ?? jobs[0] ?? null, [jobs, selecionado]);
  const fimDoChat = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fimDoChat.current?.scrollIntoView({ block: 'end' });
  }, [job?.mensagens.length]);

  const tentar = async (acao: () => Promise<unknown>) => {
    setErro(null);
    try {
      await acao();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  };

  const prontosParaOrganizar = jobs.filter((j) => j.estado !== 'rodando' && j.estado !== 'concluido').length;

  return (
    <div className="tela-principal">
      <header className="barra">
        <div className="marca">
          <img src={simbolo} alt="" />
          <div>
            <h1>Organizador de Pastas Furtado</h1>
            <span className="sub">
              {estado.ajustes.provedor === 'claude' ? 'Claude' : 'ChatGPT'} · {estado.chaveElevenLabs ? 'ElevenLabs configurado' : 'sem chave do ElevenLabs'}
            </span>
          </div>
        </div>
        <div className="acoes">
          <button onClick={() => tentar(() => api.pastas.escolher())}>Enviar pasta</button>
          <button className="primario" disabled={prontosParaOrganizar === 0} onClick={() => tentar(() => api.jobs.organizar())}>
            Organizar pasta{prontosParaOrganizar > 1 ? 's' : ''}
          </button>
          <button className="discreto" onClick={aoTrocarLogin} title="Trocar Claude/ChatGPT">
            Login
          </button>
          <button className="discreto" onClick={aoAjustes} title="Ajustes">
            ⚙ Ajustes
          </button>
        </div>
      </header>

      <div className="linha-grad" />
      {erro && <p className="erro">{erro}</p>}

      {jobs.length === 0 ? (
        <div className="vazio">
          <h2>Nenhuma pasta ainda.</h2>
          <p>
            Clique em <b>Enviar pasta</b> e escolha a pasta de um ou mais clientes. Depois, <b>Organizar pasta</b>.
          </p>
        </div>
      ) : (
        <div className="colunas">
          <ul className="lista-jobs">
            {jobs.map((j) => (
              <li key={j.id} className={`job job-${j.estado} ${job?.id === j.id ? 'job-selecionado' : ''}`} onClick={() => setSelecionado(j.id)}>
                <div className="job-linha">
                  <span className="job-nome" title={j.pasta}>
                    {j.nome}
                  </span>
                  <span className={`etiqueta etiqueta-${j.estado}`}>{NOME_ESTADO[j.estado]}</span>
                </div>
                <div className="barra-progresso">
                  <div style={{ width: `${progresso(j)}%` }} />
                </div>
                <div className="job-etapa">{j.estado === 'rodando' && j.etapa ? NOME_ETAPA[j.etapa] ?? j.etapa : j.motivo ?? ''}</div>
              </li>
            ))}
          </ul>

          {job && (
            <section className="detalhe">
              <div className="detalhe-cabecalho">
                <div>
                  <h2>{job.nome}</h2>
                  <span className="caminho">{job.pasta}</span>
                </div>
                <div className="acoes">
                  <button onClick={() => tentar(() => api.jobs.abrirPasta(job.pasta))}>Abrir pasta</button>
                  {job.estado !== 'rodando' && job.estado !== 'concluido' && (
                    <button className="primario" onClick={() => tentar(() => api.jobs.organizar(job.id))}>
                      {job.estado === 'na-fila' ? 'Organizar' : 'Tentar de novo'}
                    </button>
                  )}
                  {job.estado !== 'rodando' && (
                    <button className="discreto" onClick={() => tentar(() => api.jobs.refazer(job.id))} title="Apaga o que foi feito (menos a transcrição) e organiza de novo">
                      Refazer
                    </button>
                  )}
                  {job.estado !== 'rodando' && (
                    <button className="discreto perigo" onClick={() => tentar(() => api.jobs.remover(job.id))} title="Tira da lista (não mexe nos arquivos)">
                      Remover da lista
                    </button>
                  )}
                </div>
              </div>
              {job.motivo && <p className={`motivo motivo-${job.estado}`}>{job.motivo}</p>}
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
