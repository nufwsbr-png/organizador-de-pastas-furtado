# Organizador de Pastas Furtado

Aplicativo para Windows que organiza a pasta de cada cliente do escritório: transcreve o áudio da entrevista (ElevenLabs), responde o questionário da entrevista com base na transcrição, gera o PDF preenchido e arruma os documentos nas pastas padrão (`Contratos`, `Documentos`, `Não juntar`, `Entrevista`).

## Como usar
1. Instale o `Organizador-de-Pastas-Furtado-Setup-<versão>.exe` da aba **Releases**.
2. Abra o app e entre com a assinatura do **Claude** (Claude Code) ou do **ChatGPT** (Codex). O app oferece instalar o programa oficial se ele não estiver no PC.
3. Em **Ajustes**, cole a chave da API do ElevenLabs (fica no `.env` do app). Sem ela o app organiza a pasta, mas avisa que precisa da transcrição ou da API para preencher a entrevista.
   - A pasta pode vir com a **transcrição pronta** em vez do áudio: um arquivo `.txt`, `.docx` ou `.pdf` com "Transcrição" no nome (em qualquer subpasta). Ele é usado no lugar da API e vai para `Entrevista/Transcrição.<ext>`.
   - Perguntas feitas na ligação que não estão no roteiro entram no PDF na seção **Outras perguntas feitas**.
4. **Enviar pasta** → escolha uma ou várias pastas de clientes → **Organizar pasta**.
5. Se fechar o app, ao abrir as pastas continuam de onde pararam.

## Atualizações
Todo commit na branch `main` gera uma nova versão nas Releases. Nos outros computadores, **Ajustes → Buscar atualizações** baixa e instala.

## Desenvolvimento
```bash
npm install
npm run dev        # abre o app em modo desenvolvimento
npm test           # testes (vitest)
npm run dist       # gera o instalador em release/
```
Copie `.env.example` para `.env` e preencha `ELEVENLABS_API_KEY`.

## Visual
Identidade NuFws (pasta `Desktop/ID Visual`, manual v1.1): fundo Preto Noite, ciano como destaque, uma palavra em degradê por tela, fontes Outfit e DM Sans embutidas (funcionam sem internet).

## Para desenvolvedores
- `npx electron-vite build` e depois `electron . --captura=tela.png` renderiza a janela escondida e salva a imagem (sem abrir janela). Com `ORGANIZADOR_DADOS=<pasta>` o app usa outra pasta de dados (útil para ver a tela de login).
- Testes reais (usam a assinatura): `TESTE_REAL=1 npx vitest run test/real`.
- O app grava `log.txt`, `jobs.json`, `settings.json` e `.env` em `%APPDATA%\Organizador de Pastas Furtado`.
