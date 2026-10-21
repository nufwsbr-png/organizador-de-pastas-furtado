# Organizador de pastas

Aplicativo para Windows que organiza a pasta de cada cliente do escritório: puxa do ZapSign a procuração, a declaração e o contrato assinados, puxa do WhatsApp do escritório (WAHA) os documentos e as fotos que o cliente mandou, transcreve o áudio da entrevista (ElevenLabs), responde o questionário da entrevista com base na transcrição, gera o PDF preenchido e arruma os documentos nas pastas padrão (`Contratos`, `Documentos`, `Não juntar`, `Entrevista`) e, com a pasta completa, marca "Pasta pronta" na planilha. Várias pastas são organizadas ao mesmo tempo.

A pasta pode chegar só com o documento da entrevista (não preenchido) e a transcrição ou o áudio: o resto o app busca. O que já estiver na pasta fica, e ele só procura o que falta.

## Como usar
1. Instale o `Organizador-de-Pastas-Setup-<versão>.exe` da aba **Releases**.
2. Abra o app e entre com a assinatura do **Claude** (Claude Code) ou do **ChatGPT** (Codex). O app oferece instalar o programa oficial se ele não estiver no PC.
3. Em **Ajustes**, configure (cada PC precisa dos seus; nada disso vai para o código, que é público):
   - **ZapSign**: token da API.
   - **WhatsApp (WAHA)**: endereço (`https://pastas.nufws.com.br`), sessão (`furtado`) e a chave da API **só de leitura** dessa sessão (não envia, não desconecta e não vê as outras sessões do WAHA).
   - **Planilha**: o arquivo JSON da conta de serviço do Google (compartilhe a planilha com o e-mail dela como Editor; o app guarda o conteúdo no `.env`), o link da planilha e a aba (`Lançamentos`).

   As chaves (ZapSign, WAHA, conta de serviço e ElevenLabs) ficam todas no `.env` da pasta de dados (`%APPDATA%\Organizador de Pastas Furtado\.env`); os Ajustes só preenchem esse arquivo.
   - **ElevenLabs**: chave da API.

   Como cada parte funciona:
   - **Cliente**: o nome vem do documento da entrevista (painel "Cliente em entrevista" ou o cabeçalho da "Entrevista guiada"). O app procura esse nome na planilha e **confirma o telefone** comparando com o que o cliente usou ao assinar no ZapSign ou com o telefone do documento da entrevista (com nome repetido, o telefone decide). Se não der para confirmar, a pasta vai para **Precisam de você** com uma caixa "Dados do cliente" para informar nome e telefone.
   - **ZapSign**: a pasta pode chegar sem os documentos assinados. O app procura o cliente pelo nome da entrevista (ou da pasta), abre o envelope assinado mais recente e grava `Contratos/Procuração.pdf`, `Contratos/Declaração.pdf` e `Não juntar/Contrato Trabalhista.pdf` (só o que falta). Se não achar (nome diferente no ZapSign, envelope ainda não assinado, dois clientes parecidos), a pasta vai para **Precisam de você** com o motivo e um campo para informar o nome, o e-mail ou o link do documento no ZapSign.
   - **WhatsApp**: com o telefone confirmado, o app acha a conversa no WhatsApp do escritório e baixa **todas as fotos e documentos que o cliente mandou** (figurinha, áudio e vídeo ficam de fora; repetidos são ignorados). A IA identifica RG, CNH, CTPS e comprovante; **o que não for usado vai para `Não juntar/`**, junto com o contrato. As fotos originais do RG e da CTPS ficam guardadas em `_substituidos/`. Se a pasta já tiver RG ou CNH, CTPS e comprovante, o WhatsApp nem é consultado.
   - **Planilha**: com tudo resolvido e a pasta completa (Procuração, Declaração, RG ou CNH, CTPS, Contrato Trabalhista e Entrevista preenchida), o app marca **Pasta pronta = Sim**, pinta o marcador (coluna depois de Observações) com o mesmo verde da equipe e acrescenta "DD/MM Robô: pasta organizada pelo app" em Observações. Antes de gravar ele relocaliza a linha por nome + telefone, e depois relê; se a linha mudou de lugar no meio, desfaz. "Não" na planilha é decisão da equipe e não é trocado.
   - **ElevenLabs**: sem a chave o app organiza a pasta, mas avisa que precisa da transcrição ou da API para preencher a entrevista.
   - A pasta pode vir com a **transcrição pronta** em vez do áudio: um arquivo `.txt`, `.docx` ou `.pdf` com "Transcrição" no nome (em qualquer subpasta). Ele é usado no lugar da API e vai para `Entrevista/Transcrição.<ext>`. Se a ligação caiu e continuou em outra chamada, vêm duas ou mais: o app usa todas, em ordem de horário (a data e a hora do nome), e guarda como `Transcrição.txt`, `Transcrição 2.txt`…
   - O documento da entrevista pode vir com qualquer nome (ex.: `1700000000000-0a1b2c3d.pdf`): o app reconhece pelo texto. No formato **"Entrevista guiada"** (numeração por seção, "R:" depois de cada pergunta), as respostas que já vêm preenchidas (nome, CPF, empresa, datas) são mantidas e só as vazias (`R: .`) são respondidas com a ligação.
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
Copie `.env.example` para `.env` e preencha `ELEVENLABS_API_KEY`, `ZAPSIGN_API_TOKEN`, `WAHA_API_KEY` e `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` (o JSON da conta de serviço em base64, o mesmo formato do robô de fechar pasta). O link da planilha e o endereço do WAHA não são chaves e ficam nos Ajustes do app (`settings.json` na pasta de dados).

## Visual
ID visual Nufws v2.3 (pasta `NUFWS\IDS VISUAIS\ID Visual`, `identidade-visual.html`): base branca, grafite `#111113` nos títulos e `#1D1D1F` no texto, cinzas neutros `#515154` e `#6E6E73`, violeta profundo `#5B21D6` só como acento (botão principal com texto branco e seta, pasta em andamento, etapa atual, risco do rótulo e uma linha em degradê por tela). Tem **modo claro e noturno**: o sol/lua da barra alterna e em **Ajustes > Aparência** dá para escolher Claro, Noturno ou Igual ao Windows (padrão). O noturno usa os tons escuros da marca (`#0B0B0D`, `#151517`, linha `#27272B`, texto `#EDEDEF`) com o mesmo violeta. Quem aplica o tema é o processo principal (`nativeTheme`), então a barra de título acompanha. Símbolo "Avanço com rastro" desenhado no código (o rastro segue o tema), nome Nufws em Outfit 600 com o descritor Automações, Outfit SemiBold nos títulos e DM Sans no resto, embutidas como fontes variáveis (funcionam sem internet), nada abaixo de 13 px. Ícone do app (`build/icon.ico`): azulejo branco com o símbolo da v2.3.

## Para desenvolvedores
- `npx electron-vite build` e depois `electron . --captura=tela.png` renderiza a janela escondida e salva a imagem (sem abrir janela). Com `ORGANIZADOR_DADOS=<pasta>` o app usa outra pasta de dados (útil para ver a tela de login).
- Testes reais (usam a assinatura e o token do ZapSign do `.env`): `TESTE_REAL=1 npx vitest run test/real`. Os testes reais leem o cliente das variáveis `PASTA_ORIGEM` (a pasta de um cliente completo) e `CLIENTE_TESTE` (o nome dele na planilha), para nenhum dado de cliente ficar no código. Os do ZapSign tiram os três assinados de uma cópia dessa pasta e conferem que voltam idênticos.
- Teste real do WAHA (`test/real/waha-real.test.ts`, só leitura): pega o telefone do `CLIENTE_TESTE` na planilha, acha a conversa e baixa o que ele mandou para uma pasta temporária. Em 21/10/2026 vieram as 2 fotos que estão dentro do `RG.pdf` e o PDF idêntico ao `CTPS.pdf`. `WAHA_URL=...` troca o endereço.
- Testes reais da planilha (`test/real/planilha-real.test.ts`): leem a aba real e **gravam só numa cópia temporária da aba**, apagada no fim; conferem que a linha real não mudou.
- WAHA (motor GOWS, versão gratuita): o histórico completo é sincronizado quando o aparelho é conectado; o arquivo de mídia baixado some em 180 s, por isso cada página da conversa é baixada e gravada na hora. A URL da mídia vem com o endereço interno do WAHA e o app troca pelo configurado.
- Planilha: as colunas são achadas pelo nome do cabeçalho ("Nome do cliente", "Número de telefone", "Pasta pronta", "Observações"), porque a equipe insere e move colunas. "Pasta pronta" tem lista "Sim"/"Não": o app grava o valor da própria lista.
- ZapSign: a API não busca por nome, então o app guarda um índice da listagem em `zapsign-indice.json` (1 ano de envelopes ativos; a primeira vez leva uns 10 s, depois só lê o que entrou). `created_from` só filtra junto com `created_to`.
- O app grava `log.txt`, `jobs.json`, `settings.json`, `zapsign-indice.json` e `.env` em `%APPDATA%\Organizador de Pastas Furtado` (a pasta mantém o nome antigo do app de propósito, para não perder as chaves e as pastas em andamento de quem já usava).
