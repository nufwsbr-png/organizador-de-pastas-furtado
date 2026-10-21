import { useCallback, useEffect, useState } from 'react';
import { api, type EstadoApp, type IdProvedor } from './api';
import { Login } from './Login';
import { Principal } from './Principal';
import { Ajustes } from './Ajustes';

type Tela = 'login' | 'principal' | 'ajustes';

export function App() {
  const [estado, setEstado] = useState<EstadoApp | null>(null);
  const [tela, setTela] = useState<Tela>('login');
  const [aviso, setAviso] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    const e = await api.estado();
    setEstado(e);
    return e;
  }, []);

  useEffect(() => {
    void recarregar().then((e) => setTela(e.ajustes.provedor ? 'principal' : 'login'));
    const pararJobs = api.jobs.onMudar((jobs) => setEstado((atual) => (atual ? { ...atual, jobs } : atual)));
    const pararAtual = api.atualizacao.onMudar((atualizacao) => setEstado((atual) => (atual ? { ...atual, atualizacao } : atual)));
    const pararAviso = api.onAviso((texto) => {
      setAviso(texto);
      setTimeout(() => setAviso(null), 6000);
    });
    return () => {
      pararJobs();
      pararAtual();
      pararAviso();
    };
  }, [recarregar]);

  if (!estado) return <div className="carregando">Carregando…</div>;

  const entrar = async (id: IdProvedor) => {
    await api.provedores.escolher(id);
    await recarregar();
    setTela('principal');
  };

  return (
    <>
      {tela === 'login' && (
        <>
          <div className="mancha mancha-roxa" />
          <div className="mancha mancha-indigo" />
        </>
      )}
      {aviso && <div className="aviso-flutuante">{aviso}</div>}
      {tela === 'login' && <Login aoEntrar={entrar} provedorAtual={estado.ajustes.provedor} aoMudar={recarregar} />}
      {tela === 'principal' && <Principal estado={estado} aoAjustes={() => setTela('ajustes')} aoTrocarLogin={() => setTela('login')} aoMudar={recarregar} />}
      {tela === 'ajustes' && <Ajustes estado={estado} aoVoltar={() => setTela('principal')} aoMudar={recarregar} />}
    </>
  );
}
