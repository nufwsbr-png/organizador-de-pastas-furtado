# Plano de implementação — Organizador de Pastas Furtado

Spec: `../specs/2026-10-15-organizador-design.md` (plano aprovado em 15/10/2026). Execução inline (superpowers:executing-plans) com TDD em cada tarefa. Ledger: `.superpowers/sdd/organizador/progress.md`.

## Restrições globais
- Nunca apagar arquivo do cliente; sobrescrever guarda o anterior em `_substituidos/`.
- Toda etapa grava sua saída em `userData/jobs/<id>/` e é pulada se a saída existe (retomada).
- Sem chave ElevenLabs e sem `Transcrição.txt`: avisar com a frase combinada, não inventar.
- Login só pelos CLIs oficiais (`claude`, `codex`); sem `--bare`.
- Texto da interface e dos prompts em português.

## Tarefas
1. Bootstrap (scaffold, git, GitHub, CI).
2. `config.ts` + `fila.ts` + `job.ts`: estado persistente, retomada, semáforo.
3. `padrao.ts` + `etapas/inventario.ts`.
4. `ferramentas/pdf.ts` + `ferramentas/imagem.ts`.
5. `provedores/*`: localizar, status, claude, codex.
6. `ferramentas/elevenlabs.ts` + `etapas/transcricao.ts` + `.env`.
7. `etapas/perguntas.ts` + `respostas.ts` + `pdf-entrevista.ts` + prompts.
8. `etapas/classificar.ts` + `mover.ts`.
9. Renderer (Login, Principal, Ajustes) + IPC.
10. `atualizador.ts` + release no GitHub.
11. Entrega: pasta real, instalador, nota no vault.

Cada tarefa: teste em `test/<modulo>.test.ts` escrito antes, visto falhar, depois o código mínimo, suite verde, commit.
