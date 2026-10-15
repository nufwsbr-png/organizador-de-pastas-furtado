import { useState } from 'react';
import { api, type EstadoApp } from './api';

interface Props {
  estado: EstadoApp;
  aoVoltar: () => void;
  aoMudar: () => Promise<unknown>;
}

export function Ajustes({ estado, aoVoltar, aoMudar }: Props) {
  const [chave, setChave] = useState('');
  const [resultadoChave, setResultadoChave] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const a = estado.atualizacao;

  const salvarChave = async () => {
    setOcupado(true);
    try {
      await api.ajustes.chave(chave);
      setChave('');
      setResultadoChave('Chave salva no .env.');
      await aoMudar();
    } finally {
      setOcupado(false);
    }
  };

  const testarChave = async () => {
    setOcupado(true);
    try {
      const r = await api.ajustes.testarChave();
      setResultadoChave(r.mensagem);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="tela-ajustes">
      <header className="barra">
        <div className="marca">
          <img src="/simbolo.svg" alt="" />
          <h1>Ajustes</h1>
        </div>
        <button onClick={aoVoltar}>← Voltar</button>
      </header>
      <div className="linha-grad" />

      <section>
        <h2>Transcrição (ElevenLabs)</h2>
        <p className="sub">
          Chave da API do ElevenLabs, usada para transcrever o áudio da ligação. Fica guardada em <code>{estado.arquivoEnv}</code>.
          {estado.chaveElevenLabs ? ` Chave atual: ${estado.chaveElevenLabs}` : ' Nenhuma chave salva.'}
        </p>
        <div className="linha">
          <input type="password" placeholder="Cole a chave aqui" value={chave} onChange={(e) => setChave(e.target.value)} />
          <button className="primario" disabled={ocupado || !chave.trim()} onClick={salvarChave}>
            Salvar
          </button>
          <button disabled={ocupado || !estado.chaveElevenLabs} onClick={testarChave}>
            Testar chave
          </button>
          {estado.chaveElevenLabs && (
            <button className="discreto perigo" disabled={ocupado} onClick={() => api.ajustes.chave('').then(aoMudar)}>
              Apagar
            </button>
          )}
        </div>
        {resultadoChave && <p className="detalhe">{resultadoChave}</p>}
      </section>

      <section>
        <h2>Inteligência artificial</h2>
        <p className="sub">Provedor atual: {estado.ajustes.provedor === 'claude' ? 'Claude' : estado.ajustes.provedor === 'codex' ? 'ChatGPT (Codex)' : 'nenhum'}. Para trocar, use o botão Login na tela principal.</p>
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
        <p className="detalhe">
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
  );
}
