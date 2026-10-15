import { useEffect, useState } from 'react';
import simbolo from './assets/simbolo.svg';
import { api, type IdProvedor, type StatusProvedor } from './api';

interface Props {
  aoEntrar: (id: IdProvedor) => Promise<void>;
  provedorAtual: IdProvedor | null;
}

const INFO: Record<IdProvedor, { titulo: string; subtitulo: string; programa: string }> = {
  claude: { titulo: 'Entrar com Claude', subtitulo: 'Assinatura Claude (Pro/Max) pelo Claude Code', programa: 'Claude Code' },
  codex: { titulo: 'Entrar com ChatGPT', subtitulo: 'Assinatura ChatGPT (Plus/Pro) pelo Codex', programa: 'Codex' },
};

export function Login({ aoEntrar, provedorAtual }: Props) {
  const [status, setStatus] = useState<Record<IdProvedor, StatusProvedor> | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = async () => setStatus(await api.provedores.status());
  useEffect(() => {
    void carregar();
  }, []);

  const agir = async (rotulo: string, acao: () => Promise<unknown>) => {
    setOcupado(rotulo);
    setErro(null);
    try {
      await acao();
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="tela-login">
      <div className="marca">
        <img src={simbolo} alt="" />
        <span className="marca-nome">
          NuFws<small>Soluções IA</small>
        </span>
      </div>
      <header>
        <span className="rotulo">Organizador de pastas · Furtado</span>
        <h1>
          Pastas de clientes em <span className="destaque">ordem</span>, sozinhas.
        </h1>
        <p>Escolha com qual assinatura o app vai ler os documentos e preencher a entrevista.</p>
      </header>
      <div className="cartoes">
        {(['claude', 'codex'] as const).map((id) => {
          const s = status?.[id];
          const info = INFO[id];
          return (
            <div className={`cartao ${provedorAtual === id ? 'cartao-ativo' : ''}`} key={id}>
              <h2>{info.titulo}</h2>
              <p className="sub">{info.subtitulo}</p>
              <div className="status">
                {!status && <span>Verificando…</span>}
                {s && !s.instalado && <span className="ruim">{info.programa} não está instalado neste computador.</span>}
                {s && s.instalado && !s.logado && <span className="ruim">Instalado, mas sem login.</span>}
                {s && s.logado && <span className="bom">Logado: {s.conta}</span>}
              </div>
              <div className="acoes">
                {s && !s.instalado && (
                  <button disabled={ocupado !== null} onClick={() => agir(id, () => api.provedores.instalar(id))}>
                    {ocupado === id ? 'Instalando…' : `Instalar ${info.programa}`}
                  </button>
                )}
                {s && s.instalado && !s.logado && (
                  <button disabled={ocupado !== null} onClick={() => agir(id, () => api.provedores.login(id))}>
                    {ocupado === id ? 'Aguardando o login…' : 'Fazer login'}
                  </button>
                )}
                {s && s.logado && (
                  <button className="primario" disabled={ocupado !== null} onClick={() => aoEntrar(id)}>
                    Usar {id === 'claude' ? 'Claude' : 'ChatGPT'}
                  </button>
                )}
                {s && s.logado && (
                  <button className="discreto" disabled={ocupado !== null} onClick={() => agir(id, () => api.provedores.login(id))}>
                    Trocar conta
                  </button>
                )}
              </div>
              {s?.detalhe && !s.logado && <p className="detalhe">{s.detalhe}</p>}
            </div>
          );
        })}
      </div>
      {erro && <p className="erro">{erro}</p>}
      <p className="rodape">
        O login é feito pelo programa oficial (Claude Code ou Codex), numa janela separada. O app não guarda sua senha.
        <br />
        <button className="link" onClick={carregar}>
          Verificar de novo
        </button>
      </p>
    </div>
  );
}
