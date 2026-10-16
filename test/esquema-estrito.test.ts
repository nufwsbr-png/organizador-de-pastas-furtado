import { describe, expect, it } from 'vitest';
import { esquemaEstrito } from '../src/main/provedores/codex';
import { SCHEMA_PERGUNTAS } from '../src/main/etapas/perguntas';
import { SCHEMA_RESPOSTAS } from '../src/main/etapas/respostas';
import { SCHEMA_CLASSIFICAR } from '../src/main/etapas/classificar';

type Obj = Record<string, unknown>;

/** Percorre o esquema e falha se algum objeto não lista todas as propriedades em required. */
function conferir(s: Obj, caminho = '$'): void {
  if (s.type === 'object' || s.properties) {
    const props = Object.keys((s.properties as Obj) ?? {});
    expect(s.required, caminho).toEqual(props);
    expect(s.additionalProperties, caminho).toBe(false);
    for (const [k, v] of Object.entries((s.properties as Obj) ?? {})) conferir(v as Obj, `${caminho}.${k}`);
  }
  if (s.items) conferir(s.items as Obj, `${caminho}[]`);
}

describe('esquemaEstrito (exigência do Codex/OpenAI)', () => {
  it('coloca toda propriedade em required e fecha additionalProperties', () => {
    for (const s of [SCHEMA_PERGUNTAS, SCHEMA_RESPOSTAS, SCHEMA_CLASSIFICAR]) conferir(esquemaEstrito(s) as Obj);
  });

  it('propriedade que era opcional passa a aceitar null', () => {
    const e = esquemaEstrito(SCHEMA_PERGUNTAS) as Obj;
    const dados = (e.properties as Obj).dadosCliente as Obj;
    expect(dados.type).toEqual(['object', 'null']);
    expect((dados.properties as Obj).nome).toEqual({ type: ['string', 'null'] });
  });

  it('não altera o esquema original', () => {
    const antes = JSON.stringify(SCHEMA_PERGUNTAS);
    esquemaEstrito(SCHEMA_PERGUNTAS);
    expect(JSON.stringify(SCHEMA_PERGUNTAS)).toBe(antes);
  });
});
