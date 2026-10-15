# Organizador de Pastas Furtado

Aplicativo para Windows que organiza a pasta de cada cliente do escritório: transcreve o áudio da entrevista (ElevenLabs), responde o questionário da entrevista com base na transcrição, gera o PDF preenchido e arruma os documentos nas pastas padrão (`Contratos`, `Documentos`, `Não juntar`, `Entrevista`).

## Como usar
1. Instale o `Organizador-de-Pastas-Furtado-Setup-<versão>.exe` da aba **Releases**.
2. Abra o app e entre com a assinatura do **Claude** (Claude Code) ou do **ChatGPT** (Codex). O app oferece instalar o programa oficial se ele não estiver no PC.
3. Em **Ajustes**, cole a chave da API do ElevenLabs (fica no `.env` do app). Sem ela o app organiza a pasta, mas avisa que precisa da transcrição ou da API para preencher a entrevista.
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
