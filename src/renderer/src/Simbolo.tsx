import { useId } from 'react';

/** Símbolo Nufws (avanço com rastro, ID visual v2.3): seta no degradê Onda; o rastro segue a cor do tema (grafite no claro, branco no noturno). */
export function Simbolo({ className = 'simbolo' }: { className?: string }) {
  const id = `onda${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg className={className} viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#3A1078" />
          <stop offset=".55" stopColor="#5B21D6" />
          <stop offset="1" stopColor="#9F67FF" />
        </linearGradient>
      </defs>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="34,60 74,100 34,140" stroke="currentColor" strokeWidth="9" opacity=".18" />
        <polyline points="66,56 110,100 66,144" stroke="currentColor" strokeWidth="13" opacity=".45" />
        <polyline points="104,50 154,100 104,150" stroke={`url(#${id})`} strokeWidth="20" />
      </g>
    </svg>
  );
}
