# Organizador de Pastas Furtado

Aplicativo para Windows que organiza a pasta de cada cliente do escritório: puxa do ZapSign a procuração, a declaração e o contrato assinados, transcreve o áudio da entrevista (ElevenLabs), responde o questionário da entrevista com base na transcrição, gera o PDF preenchido e arruma os documentos nas pastas padrão (`Contratos`, `Documentos`, `Não juntar`, `Entrevista`). Várias pastas são organizadas ao mesmo tempo.

## Como usar
1. Instale o `Organizador-de-Pastas-Furtado-Setup-<versão>.exe` da aba **Releases**.
2. Abra o app e entre com a assinatura do **Claude** (Claude Code) ou do **ChatGPT** (Codex). O app oferece instalar o programa oficial se ele não estiver no PC.
3. Em **Ajustes**, cole o token da API do **ZapSign** e a chave da API do **ElevenLabs** (os dois ficam no `.env` do app; cada PC precisa dos seus).
   - **ZapSign**: a pasta pode chegar sem os documentos assinados. O app procura o cliente pelo nome da pasta, abre o envelope assinado mais recente e grava `Contratos/Procuração.pdf`, `Contratos/Declaração.pdf` e `Não juntar/Contrato Trabalhista.pdf` (só o que falta). Se não achar (nome diferente no ZapSign, envelope ainda não assinado, dois clientes parecidos), a pasta vai para **Precisam de você** com o motivo e um campo para informar o nome, o e-mail ou o link do documento no ZapSign.
   - **ElevenLabs**: sem a chave o app organiza a pasta, mas avisa que precisa da transcrição ou da API para preencher a entrevista.
   - A pasta pode vir com a **transcrição pronta** em vez do áudio: um arquivo `.txt`, `.docx` ou `.pdf` com "Transcrição" no nome (em qualquer subpasta). Ele é usado no lugar da API e vai para `Entrevista/Transcrição.<ext>`.
   - Perguntas feitas na ligação que não estão no roteiro entram no PDF na seção **Outras perguntas feitas**.
4. **Enviar pasta** → escolha uma ou várias pastas de clientes → **Organizar pasta**. Até 3 pastas rodam ao mesmo tempo (muda em Ajustes); as outras esperam a vez.
5. A lista separa as pastas em **Organizando agora**, **Para organizar**, **Precisam de você** e **Concluídas**.
6. Se fechar o app, ao abrir as pastas continuam de onde pararam.

## Atualizações
Todo commit na branch `main` gera uma nova versão nas Releases. Nos outros computadores, **Ajustes → Buscar atualizações** baixa e instala.

## Desenvolvimento
```bash
npm install
npm run dev        # abre o app em modo desenvolvimento
npm test           # testes (vitest)
npm run dist       # gera o instalador em release/
```
Copie `.env.example` para `.env` e preencha `ELEVENLABS_API_KEY` e `ZAPSIGN_API_TOKEN`.

## Visual
ID visual Nufws v2.0 (pasta `NUFWS\IDS VISUAIS\ID Visual`, `identidade-visual.html`): fundo grafite `#0D0B12`, roxo `#7B2FF7` como sinal (botão com texto branco e seta), texto em névoa `#EDEAF5` e cinza `#9B8FC4`, rótulos em caixa alta com o risco violeta, uma linha em degradê por tela (sob o cabeçalho; no login, a palavra em destaque), símbolo "Avanço com rastro" e o nome Nufws em Outfit 600 com o descritor Automações. Outfit leve nos títulos e DM Sans no resto, embutidas como fontes variáveis (funcionam sem internet). Ícone do app = `logo/icone-nufws.ico`.

## Para desenvolvedores
- `npx electron-vite build` e depois `electron . --captura=tela.png` renderiza a janela escondida e salva a imagem (sem abrir janela). Com `ORGANIZADOR_DADOS=<pasta>` o app usa outra pasta de dados (útil para ver a tela de login).
- Testes reais (usam a assinatura e o token do ZapSign do `.env`): `TESTE_REAL=1 npx vitest run test/real`. Os do ZapSign tiram os três assinados de uma cópia da pasta da Elisângela e conferem que voltam idênticos.
- ZapSign: a API não busca por nome, então o app guarda um índice da listagem em `zapsign-indice.json` (1 ano de envelopes ativos; a primeira vez leva uns 10 s, depois só lê o que entrou). `created_from` só filtra junto com `created_to`.
- O app grava `log.txt`, `jobs.json`, `settings.json`, `zapsign-indice.json` e `.env` em `%APPDATA%\Organizador de Pastas Furtado`.
