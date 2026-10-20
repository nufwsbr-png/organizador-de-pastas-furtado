# Plano — Organizador de Pastas Furtado (app desktop)

## Contexto

O escritório trabalhista Furtado recebe a pasta de cada cliente desorganizada. O padrão final já existe (skill `fechar-pasta`): `Contratos/`, `Documentos/`, `Não juntar/` com nomes fixos de arquivo, tudo em PDF. A pasta de exemplo `C:\Users\Computador08\Downloads\Elisângela Cristina Mariano` já está nesse padrão, faltando só a parte nova: transcrever o áudio da entrevista (`Áudio da ligação.wav`, 18 min, 16 kHz mono), responder as 23 perguntas de `Perguntas entrevista .pdf` (PDF só com imagens/prints do Ophir) com base na transcrição, gerar o documento preenchido e guardar os 3 arquivos em `Entrevista/`.

O usuário quer um app instalável no Windows que: faça login com a assinatura do Claude **ou** do ChatGPT; receba várias pastas e organize em paralelo; retome de onde parou se fechar; fique no GitHub e se atualize nos outros PCs por um botão "Buscar atualizações" nos ajustes, a cada commit na `main`.

Decisões já tomadas com o usuário (15/10/2026):
- **Login pelos programas oficiais** (Claude Code CLI e Codex CLI instalados no PC). O app não implementa OAuth próprio: Anthropic não permite login claude.ai em app de terceiros; aqui a ferramenta e a conta são do próprio usuário. Nesta máquina: `claude auth status` → logado, Max; `codex login status` → "Logged in using ChatGPT".
- **Transcrição pela API do ElevenLabs (Scribe v2)**, chave `ELEVENLABS_API_KEY` no `.env` (decisão do usuário, 15/10/2026, depois de saber que nem o Claude Code nem o Codex aceitam áudio). **Sem a chave**, o app não inventa: o job organiza os documentos normalmente, mas a etapa da entrevista fica pendente e o app diz: "Para preencher a entrevista preciso da transcrição da ligação ou de uma API de transcrição (ElevenLabs). Coloque um arquivo `Transcrição.txt` na pasta ou a chave em Ajustes → .env." Se houver `Transcrição.txt` na pasta, ele é usado no lugar da API. **Atualização 16/10/2026** (pedido do usuário): a pasta pode chegar com a transcrição pronta em vez do áudio, em `.txt`, `.docx` ou `.pdf` com "transcri" no nome, em qualquer subpasta; é lida (mammoth para docx, pdfjs para pdf), organizada como documento padrão `Entrevista/Transcrição.<ext>` e a entrevista segue normalmente. As perguntas feitas na ligação fora do roteiro saem no PDF na seção "Outras perguntas feitas" (campo `outrasPerguntas` do esquema das respostas, gravado em `outras-perguntas.json`).
- **Atualização 20/10/2026** (pedido do usuário): (1) várias pastas ao mesmo tempo, com a lista separada em Organizando agora / Para organizar / Precisam de você / Concluídas (novo estado `aguardando` = esperando vaga do paralelismo); (2) **ZapSign pela API**: a pasta chega sem os assinados; a etapa `zapsign` (logo depois do inventário) acha o envelope do cliente pelo nome da pasta (ou nome/e-mail/link informado na tela), baixa a Procuração, a Declaração e o Contrato Trabalhista assinados que faltam direto no padrão e refaz o inventário. Sem token, sem envelope ou envelope não assinado → etapa pendente (o resto da pasta segue). A API não busca por nome: índice local da listagem (`zapsign-indice.json`, 1 ano, `deleted=false`, `created_from` + `created_to`; `created_from` sozinho é ignorado), sincronizado ao abrir o app e de forma incremental. Testado contra a conta real: os 3 PDFs da Elisângela voltam idênticos byte a byte; (3) visual: primeiro no ID Nufws roxo (pasta `NUFWS - ID VISUAL ROXO`) e, no mesmo dia, a pedido dele, trocado pelo ID da pasta `NUFWS\IDS VISUAIS\ID Visual` (interfaces da v1.1 com a paleta roxa: seta "Avanço com rastro", Outfit leve + DM Sans, linha em degradê, rótulo com risco violeta).
- **Entrega final = aplicativo instalável** (`.exe` NSIS) publicado nas releases do GitHub.
- **Documento da entrevista**: PDF, com a transcrição completa em anexo no fim.
- **Repositório público**: `github.com/nufwsbr-png/organizador-de-pastas-furtado` (conta `gh` logada: nufwsbr-png; git user Nunes1312 / eduardonf4@gmail.com).

Metodologia: usar o **superpowers** (obra/superpowers) — clonar no scratchpad, ler `brainstorming`, `writing-plans`, `executing-plans`, `test-driven-development`; gravar o design em `docs/superpowers/specs/2026-10-15-organizador-design.md` e o plano de tarefas em `docs/superpowers/plans/2026-10-15-organizador.md` dentro do repo; executar tarefa a tarefa com teste antes do código (RED → GREEN) e commits pequenos.

## Ambiente verificado

node 24.17, npm 11, git 2.54, gh 2.95 (logado), claude 2.1.220, codex 0.146, Python 3.12. PC: i7-7700K, GTX 1080 Ti, 32 GB. Pasta do projeto vazia: `C:\Users\Computador08\Desktop\Organizador de pastas furtado` (ainda não é git).

## Arquitetura

**Electron + TypeScript**, renderer em React + Vite (mesmo padrão do modelo em `~/.claude/skills/criar-robo-fechador-pasta/assets/modelo/web`), instalador NSIS via `electron-builder`, atualização via `electron-updater` (provider GitHub). Sem backend: tudo roda no processo principal.

```
organizador-de-pastas-furtado/
  package.json            # version "0.0.0" no repo; o CI grava 1.0.<run_number>
  electron-builder.yml    # win nsis x64, publish: github nufwsbr-png/organizador-de-pastas-furtado
  .github/workflows/release.yml
  src/main/
    index.ts              # janela, IPC, inicia fila, checa atualização
    ipc.ts                # canais tipados (contextBridge no preload)
    config.ts             # settings.json em userData (provedor, paralelismo) + leitura/escrita do .env (ELEVENLABS_API_KEY)
    fila.ts               # fila de jobs persistente + retomada
    job.ts                # máquina de etapas de um job (idempotente)
    etapas/
      inventario.ts       # lista arquivos, detecta o que já está no lugar
      transcricao.ts      # Transcrição.txt na pasta? usa; senão ElevenLabs STT; sem chave → pendente com aviso
      perguntas.ts        # PDF de perguntas → PNG por página → LLM extrai JSON de perguntas
      respostas.ts        # perguntas + transcrição → LLM responde JSON
      pdf-entrevista.ts   # pdfkit: capa, 23 Q&A, anexo transcrição
      classificar.ts      # digest de cada arquivo (texto ou PNG) → LLM classifica → plano de movimentos
      mover.ts            # aplica o plano: cria pastas, renomeia, imagem→PDF, junta frente/verso, "Revisar/"
    provedores/
      tipos.ts            # interface Provedor { id, verificarLogin, rodar({prompt, schema, imagens, cwd}) }
      claude.ts           # spawn claude -p --output-format json --json-schema ... (stdin = prompt)
      codex.ts            # spawn codex exec - --json --output-schema f -o out.json -C cwd --sandbox read-only --skip-git-repo-check --ephemeral -i img...
      localizar.ts        # acha claude.exe / codex no PATH e em ~/.local/bin, %APPDATA%\npm
      instalar.ts         # abre terminal com o instalador oficial / login
    ferramentas/
      elevenlabs.ts       # POST https://api.elevenlabs.io/v1/speech-to-text (multipart, header xi-api-key)
      pdf.ts              # pdfjs-dist + @napi-rs/canvas: texto e rasterização de páginas
      imagem.ts           # sharp/pdf-lib: jpg/png → PDF, juntar páginas
    atualizador.ts        # electron-updater: checar, baixar, instalar
  src/preload/index.ts
  src/renderer/           # React: Login, Principal (lista de jobs), Ajustes
  test/                   # vitest: unidades puras + fixtures
  docs/superpowers/{specs,plans}/
```

### Fluxo de um job (pasta)

Etapas, cada uma grava sua saída em `userData/jobs/<id>/` e é pulada se a saída já existe (é assim que retoma):

1. `inventario` → `inventario.json` (todos os arquivos, hash de tamanho+mtime, o que já está no padrão).
2. `transcricao` → `transcricao.txt` (com falantes: "Atendente:"/"Cliente:" a partir do `speaker_id`). Ordem: (a) existe `Transcrição.txt` na pasta → usa; (b) existe `ELEVENLABS_API_KEY` → envia cada áudio; (c) nenhum dos dois → etapa `pendente` com a mensagem de aviso, e as etapas 3–5 ficam pendentes também (6–7 seguem). Sem áudio na pasta → "sem áudio", 3–5 puladas. Ao colocar a chave ou o `.txt` e clicar "Organizar" de novo, o job retoma daqui.
3. `perguntas` → `perguntas.json` (`[{numero, secao, pergunta, simNao: bool}]`). Fonte: PDF cujo nome contém "pergunta"/"entrevista", rasterizado página a página.
4. `respostas` → `respostas.json` (`[{numero, simNao: "Sim"|"Não"|null, resposta, naoRespondida: bool}]`). Regra no prompt: só o que a cliente disse; sem inventar; "Não abordado na ligação" quando não houver.
5. `pdf-entrevista` → `Entrevista preenchida.pdf` (cabeçalho: nome da pasta, empresa/cargo se detectados; seções; anexo com a transcrição).
6. `classificar` → `plano-movimentos.json`: para cada arquivo fora do lugar, destino `{pasta, nome}` ou `Revisar`. Digest = texto do PDF (pdfjs) ou, se < 50 caracteres (digitalização), PNG das 2 primeiras páginas. Imagens soltas entram como PNG. Arquivos já corretos não vão ao LLM.
7. `mover` → executa o plano (nunca apaga; sobrescrever → guarda o anterior em `_substituidos/`), grava `movimentos.json`, cria `Entrevista/` com `Perguntas entrevista.pdf`, o(s) áudio(s) e `Entrevista preenchida.pdf`.
8. `concluido` (ou `atencao` se houve `Revisar/` ou perguntas sem resposta).

Estrutura-alvo (da skill `fechar-pasta`, linhas 112–120 de `~/.claude/skills/fechar-pasta/SKILL.md`):

| Pasta | Arquivos |
|---|---|
| Contratos | `Procuração.pdf`, `Declaração.pdf` |
| Documentos | `RG.pdf` ou `CNH.pdf` (frente+verso num só), `CTPS.pdf` |
| Não juntar | `Contrato Trabalhista.pdf`, `Comprovante de residência.pdf` |
| Entrevista | `Perguntas entrevista.pdf`, `Áudio da ligação.<ext>`, `Entrevista preenchida.pdf` |
| Revisar | o que o LLM não soube classificar (aparece como alerta no app) |

### Paralelismo e retomada

- `fila.ts`: `jobs.json` em userData (escrita atômica: tmp + rename). Estados: `na-fila`, `rodando`, `pausado`, `atencao`, `concluido`, `erro`.
- Semáforo `paralelismoJobs` (padrão 3, ajustes). Transcrições e chamadas ao LLM correm em paralelo entre jobs.
- Na abertura do app: todo job `rodando`/`na-fila` volta para `na-fila` e é retomado (as etapas pulam o que já tem saída). Processos filhos (whisper/claude/codex) são mortos no `before-quit`.
- O limite da assinatura (`rate_limit`/`authentication_failed` no JSON do claude; erro no JSONL do codex) vira estado `pausado` com motivo e botão "Tentar de novo".

### Provedores (login com assinatura)

- `localizar.ts`: `claude` → `%USERPROFILE%\.local\bin\claude.exe`, `%APPDATA%\npm\claude.cmd`, PATH; `codex` → `%APPDATA%\npm\codex.cmd`, PATH, `userData/bin/codex.exe` (binário baixado da release `openai/codex`).
- Status: `claude auth status` (JSON com `loggedIn`, `subscriptionType`) e `codex login status` (texto "Logged in using ChatGPT").
- Login: botão abre uma janela de terminal (`cmd /c start`) rodando `claude` (usuário digita `/login`) ou `codex login`; ao fechar, o app reconsulta o status. Se o CLI não existe: botão "Instalar" roda `irm https://claude.ai/install.ps1 | iex` (Claude) ou baixa o binário do Codex.
- `claude.ts`: **não usar `--bare`** (bare ignora o login da assinatura). Args: `-p --output-format json --json-schema <schema> --max-turns 25 --permission-mode dontAsk --allowedTools "Read" --add-dir <pastaDoJob>`, env `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, prompt por stdin (limite 10 MB), resultado em `.structured_output`. Imagens e PDFs são lidos pelo próprio Claude (tool Read) a partir dos caminhos citados no prompt.
- `codex.ts`: `codex exec - --json --output-schema <arq> -o <saida.json> -C <pastaDoJob> --sandbox read-only --skip-git-repo-check --ephemeral -i <png>...`; texto dos PDFs vai no prompt (o Codex não lê PDF sozinho).
- Prompts em `src/main/prompts/*.md` (perguntas, respostas, classificação), em português, com o esquema JSON ao lado.

### Transcrição (ElevenLabs Scribe v2)

- `elevenlabs.ts`: `POST https://api.elevenlabs.io/v1/speech-to-text`, header `xi-api-key`, multipart com `file`, `model_id=scribe_v2`, `language_code=por`, `diarize=true`, `num_speakers=2`, `timestamps_granularity=word`. Usa `fetch`/`FormData`/`Blob` nativos do Node 24 (sem SDK). Resposta síncrona: `text` + `words[]` com `speaker_id`; monta o texto por falante (quebra de parágrafo a cada troca de `speaker_id`). Limites: 3 GB e 10 h por arquivo; a ligação de 35 MB vai inteira, sem cortar.
- Erros: 401 → "chave inválida"; 422/429/5xx → job `pausado` com o motivo e botão "Tentar de novo". Timeout de 15 min por arquivo.
- Chave: `ELEVENLABS_API_KEY` lida de `.env` na raiz do projeto (dev) e de `%APPDATA%\organizador-de-pastas-furtado\.env` (instalado). Ajustes tem o campo "Chave ElevenLabs" que grava nesse `.env`. `.env` no `.gitignore`; `.env.example` no repo.

### Atualização pelo GitHub

- `electron-builder.yml`: `appId`, `productName: Organizador de Pastas Furtado`, `win: {target: nsis}`, `nsis: {oneClick: false, perMachine: false}`, `publish: {provider: github, owner: nufwsbr-png, repo: organizador-de-pastas-furtado}`.
- `.github/workflows/release.yml`: `on: push: branches: [main]`, `runs-on: windows-latest`, `permissions: contents: write`; passos: checkout → setup-node 24 → `npm ci` → `npm version 1.0.${{ github.run_number }} --no-git-tag-version` → `npm test` → `npx electron-builder --win --publish always` com `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. Cada push na `main` gera a release `v1.0.N` com `latest.yml` + instalador + blockmap; `run_number` só cresce, então o `electron-updater` sempre vê a nova como mais nova.
- `atualizador.ts`: `autoUpdater.autoDownload = false`; no botão "Buscar atualizações": `checkForUpdates()` → eventos `update-available`/`update-not-available`/`download-progress`/`update-downloaded`/`error` mandados ao renderer; "Baixar" → `downloadUpdate()`; "Reiniciar e instalar" → `quitAndInstall()`. Checagem silenciosa ao abrir (só avisa). Em dev (`!app.isPackaged`) o botão mostra "indisponível em desenvolvimento".

### Interface (renderer)

- **Login**: dois cartões (Claude / ChatGPT) com status (instalado? logado? conta), botões Instalar / Entrar / Usar este. Provedor escolhido fica em settings.
- **Principal**: lista de pastas (nome, etapa atual com barra, estado, alertas), botões **Enviar pasta** (`dialog.showOpenDialog` com `openDirectory`, `multiSelections`) e **Organizar pasta** (inicia tudo que está na fila; também por item). Clique na pasta → detalhes (log das etapas, abrir pasta no Explorer, ver `Revisar`).
- **Ajustes** (engrenagem): provedor, chave ElevenLabs (grava no `.env`, com "Testar chave"), paralelismo, versão instalada, **Buscar atualizações**, abrir pasta de logs.
- **Mensagens do job** (painel tipo chat em cada pasta): cada etapa escreve linhas ("Transcrevendo Áudio da ligação.wav…", "23 perguntas encontradas", "RG.jpeg → Documentos/RG.pdf"). É aqui que aparece o aviso de falta de transcrição/API.

## Tarefas (ordem de execução, cada uma com teste primeiro e commit)

1. **Bootstrap**: clonar superpowers no scratchpad e ler as 4 skills; `git init`; scaffold Electron+Vite+React+TS (electron-vite), vitest, electron-builder.yml, README em português; `gh repo create nufwsbr-png/organizador-de-pastas-furtado --public --source . --push`. Escrever `docs/superpowers/specs/...-design.md` e `docs/superpowers/plans/...md` a partir deste plano.
2. **Config + fila persistente** (`config.ts`, `fila.ts`, `job.ts`): testes de escrita atômica, retomada (job `rodando` volta à fila, etapa com saída é pulada), semáforos.
3. **Inventário** (`inventario.ts`) + regras do padrão-alvo (`padrao.ts`: tabela acima, função `estaNoLugar(caminho)`): testes com árvore fictícia.
4. **Ferramentas PDF/imagem** (`pdf.ts`, `imagem.ts`): texto via pdfjs, rasterização via @napi-rs/canvas, jpg→pdf, juntar páginas. Testar com os PDFs reais da Elisângela (cópia em fixtures só se forem pequenos; senão apontar para a pasta, pulando se ausente).
5. **Provedores** (`tipos.ts`, `localizar.ts`, `claude.ts`, `codex.ts`): testes de montagem de args e parse de saída com JSON gravado; teste de integração manual com `claude -p` real (pergunta trivial com schema).
6. **Transcrição** (`elevenlabs.ts`, `transcricao.ts`, `.env`): testes com servidor HTTP falso (resposta gravada com `words`/`speaker_id` → texto por falante; 401; sem chave → pendente com a mensagem exata; `Transcrição.txt` presente → não chama a API). Teste real: transcrever `Áudio da ligação.wav` (≈18 min) com a chave do usuário e conferir legibilidade.
7. **Perguntas + Respostas + PDF** (`perguntas.ts`, `respostas.ts`, `pdf-entrevista.ts`, prompts): rodar na pasta real; conferir que as 23 perguntas saem e que as respostas citam só a transcrição.
8. **Classificar + Mover** (`classificar.ts`, `mover.ts`): testes com pasta fictícia desorganizada (nomes como `WhatsApp Image.jpeg`, `doc (2).pdf`); regra de nunca apagar; `Revisar/`.
9. **Renderer**: Login, Principal, Ajustes; IPC tipado; estados em tempo real.
10. **Atualizador + CI**: `atualizador.ts`, workflow; push → conferir release `v1.0.1` com `latest.yml`; instalar o `.exe` nesta máquina; novo push → o botão "Buscar atualizações" acha `v1.0.2`.
11. **Entrega**: rodar o app empacotado na pasta real `Elisângela Cristina Mariano` (antes em uma cópia no scratchpad); conferir a pasta final; salvar no vault do Obsidian (`Projetos/`) a nota do projeto com as decisões acima e indexar em `MEMORIA.md`.

## Verificação (fim a fim)

1. `npm test` verde (vitest).
2. `npm run dev`: tela de login mostra Claude logado (Max) e ChatGPT logado; escolher Claude.
3. Enviar uma **cópia** da pasta Elisângela desorganizada de propósito (arquivos soltos na raiz, uma foto `.jpg`) e outra cópia intacta; clicar Organizar: os dois jobs rodam ao mesmo tempo (whisper em série), terminam com a estrutura da tabela, `Entrevista/` com os 3 arquivos, PDF com 23 respostas coerentes com o áudio.
4. Fechar o app no meio (durante a classificação, por exemplo); reabrir: o job retoma da etapa pendente, sem refazer o que já tinha saída.
4b. Sem `ELEVENLABS_API_KEY` e sem `Transcrição.txt`: a pasta é organizada, `Entrevista/` recebe perguntas + áudio, e o painel mostra a mensagem pedindo a transcrição ou a API; ao gravar a chave em Ajustes e clicar Organizar, o job completa a entrevista.
5. Trocar para ChatGPT nos ajustes e repetir uma pasta: mesmo resultado via `codex exec`.
6. Build: `npx electron-builder --win` gera o instalador; instalar; push na `main` → release no GitHub → "Buscar atualizações" encontra, baixa e instala.
7. Rodar na pasta real da Elisângela e conferir o resultado com o usuário.

## Riscos e decisões assumidas

- Áudio de ligação pode ter trechos ruins: o PDF marca perguntas "não respondidas" em vez de inventar. A chave do ElevenLabs é cobrada por hora de áudio; cada PC precisa da sua cópia do `.env` (ou a mesma chave).
- Office PCs sem Node: o instalador do Claude Code é nativo (não precisa de Node); Codex vai por binário da release. Precisa de internet (ElevenLabs, Claude/ChatGPT, GitHub).
- O PDF de perguntas é imagem: extração depende do LLM ler PNGs; validar contagem (23) e numeração contínua, senão marcar `atencao`.
- `claude -p` sem `--bare` carrega `~/.claude` da máquina; nos PCs do escritório isso é vazio. Nesta máquina há hooks/skills do usuário: usar `--setting-sources user` apenas se der problema.
- Pasta do projeto fica no Desktop (pode estar no OneDrive); `node_modules` e `dist` ficam no `.gitignore` e o OneDrive pode reclamar — se atrapalhar, mover o repo para `C:\Projetos\`.
