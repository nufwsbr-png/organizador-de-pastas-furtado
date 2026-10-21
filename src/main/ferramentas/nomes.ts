/** Comparação de nomes e telefones de clientes (ZapSign, planilha e WhatsApp usam as mesmas regras). */

/** Palavras de um nome sem acento, minúsculas; só as com mais de 2 letras contam. */
export function palavrasDoNome(nome: string): string[] {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length > 2);
}

/**
 * Quanto o nome procurado bate com o encontrado:
 * 'igual' = mesmas palavras; 'parecido' = um contém todas as palavras do outro (no mínimo duas);
 * null = não é a mesma pessoa.
 */
export function grauNome(procurado: string, encontrado: string): 'igual' | 'parecido' | null {
  const a = palavrasDoNome(procurado);
  const b = palavrasDoNome(encontrado);
  if (a.length === 0 || b.length === 0) return null;
  const sa = new Set(a);
  const sb = new Set(b);
  if (a.join(' ') === b.join(' ')) return 'igual';
  const aEmB = a.every((p) => sb.has(p));
  const bEmA = b.every((p) => sa.has(p));
  if ((aEmB && a.length >= 2) || (bEmA && b.length >= 2)) return 'parecido';
  return null;
}

export function digitos(texto: string | null | undefined): string {
  return (texto ?? '').replace(/\D/g, '');
}

/** Mesmo telefone: os 8 últimos dígitos batem (com ou sem 55, DDD e o nono dígito). */
export function mesmoTelefone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = digitos(a);
  const y = digitos(b);
  return x.length >= 8 && y.length >= 8 && x.slice(-8) === y.slice(-8);
}

/** Telefone brasileiro só com DDD + número (10 ou 11 dígitos), sem o 55; null se não parecer um. */
export function telefoneNacional(texto: string | null | undefined): string | null {
  let d = digitos(texto);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : null;
}

/** (DD) 99999-9999 para mostrar na tela e no log. */
export function formatarTelefone(texto: string | null | undefined): string {
  const d = telefoneNacional(texto);
  if (!d) return texto ?? '';
  return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
}
