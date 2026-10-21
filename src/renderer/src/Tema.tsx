import { useEffect, useState } from 'react';
import { api } from './api';

const consulta = window.matchMedia('(prefers-color-scheme: dark)');

/** Se a tela está no modo noturno agora (o processo principal decide, pelo ajuste ou pelo Windows). */
export function useNoturno(): boolean {
  const [noturno, setNoturno] = useState(consulta.matches);
  useEffect(() => {
    const mudar = () => setNoturno(consulta.matches);
    consulta.addEventListener('change', mudar);
    return () => consulta.removeEventListener('change', mudar);
  }, []);
  return noturno;
}

/** Sol/lua da barra: alterna entre claro e noturno (e deixa de seguir o Windows). */
export function BotaoTema({ aoMudar }: { aoMudar: () => Promise<unknown> }) {
  const noturno = useNoturno();
  const titulo = noturno ? 'Mudar para o modo claro' : 'Mudar para o modo noturno';
  return (
    <button className="discreto icone" title={titulo} aria-label={titulo} onClick={() => api.ajustes.definir({ tema: noturno ? 'claro' : 'escuro' }).then(aoMudar)}>
      {noturno ? (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        </svg>
      )}
    </button>
  );
}
