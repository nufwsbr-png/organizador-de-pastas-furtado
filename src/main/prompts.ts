/** Prompts em português usados pelas etapas que chamam a IA. */

export const PROMPT_PERGUNTAS = (imagens: string[]) => `Você está lendo as páginas de um PDF com o roteiro de uma entrevista trabalhista (prints de um sistema). As páginas estão nestas imagens, em ordem:

${imagens.map((i, n) => `${n + 1}. ${i}`).join('\n')}

Leia TODAS as imagens com atenção e extraia:
1. A lista completa de perguntas, na ordem, com o número que aparece ao lado de cada uma (01, 02, ...), a seção a que pertence (o título "Seção · ..." que aparece acima) e se a pergunta tem os botões "Sim / Não" (simNao = true) ou só o campo de texto (simNao = false).
2. Os dados do cliente que aparecem no painel "Cliente em entrevista" (nome, empresa, cargo, vínculo, salário), quando existirem.

Regras:
- Copie o texto de cada pergunta exatamente como está, sem resumir.
- Se o título da seção de uma pergunta não aparecer na página (a página começa no meio da seção), use o título da última seção vista; se nenhum título apareceu ainda, use "Entrevista". Nunca escreva observações no campo secao.
- Não invente perguntas; se uma página estiver ilegível, pule-a.
- A numeração deve ser contínua (1, 2, 3, ...).
- Responda SOMENTE no formato JSON pedido.`;

export const PROMPT_RESPOSTAS = (perguntas: string, transcricao: string) => `Você é assistente de um escritório de advocacia trabalhista. Abaixo estão as perguntas de uma entrevista e a transcrição da ligação em que a atendente fez essas perguntas ao cliente (a transcrição vem separada por falante e pode ter erros de reconhecimento de voz).

Sua tarefa tem duas partes:
1. Para CADA pergunta da lista, escrever a resposta do cliente com base SOMENTE no que ele disse na ligação.
2. Em "outrasPerguntas" (outras perguntas feitas), listar as perguntas que a atendente fez na ligação e que NÃO estão na lista (nem são só uma reformulação de uma pergunta da lista), cada uma com a resposta do cliente. Se não houve nenhuma, devolva a lista vazia.

Regras obrigatórias:
- Use apenas o que está na transcrição. NUNCA invente, complete ou deduza fatos que o cliente não disse.
- Escreva a resposta em terceira pessoa, de forma clara e completa, preservando detalhes úteis (nomes, datas, horários, valores, locais, quantas vezes, quem fazia). Pode juntar trechos que o cliente falou em momentos diferentes da ligação.
- Se a pergunta tem opção Sim/Não, preencha simNao com "Sim" ou "Não" conforme o que o cliente disse; se ele não deixou claro, use null.
- Se o assunto da pergunta não foi tratado na ligação, marque naoRespondida = true e deixe resposta vazia. Não escreva "não informado" na resposta.
- Mantenha o número de cada pergunta igual ao da lista.
- Em outrasPerguntas, escreva a pergunta como a atendente fez (resumida se for longa) e a resposta nas mesmas regras acima; não inclua cumprimentos, confirmação de dados cadastrais nem perguntas sem resposta.
- Responda SOMENTE no formato JSON pedido, com uma entrada em respostas para cada pergunta da lista.

PERGUNTAS:
${perguntas}

TRANSCRIÇÃO DA LIGAÇÃO:
${transcricao}`;

export const PROMPT_CLASSIFICAR = (itens: string) => `Você organiza a pasta de um cliente de um escritório de advocacia trabalhista. Cada arquivo abaixo precisa ser classificado em um destes tipos:

- "Procuração": procuração ad judicia / instrumento de mandato para os advogados.
- "Declaração": declaração de hipossuficiência / de pobreza / para justiça gratuita.
- "RG": documento de identidade (RG, carteira de identidade, CIN). Frente e verso são o MESMO documento.
- "CNH": carteira nacional de habilitação (usada como identidade quando não há RG).
- "CTPS": carteira de trabalho (física ou digital), incluindo as páginas de contrato de trabalho.
- "Contrato Trabalhista": contrato de honorários / contrato de prestação de serviços advocatícios entre o cliente e o escritório.
- "Comprovante de residência": conta de luz, água, telefone, internet, fatura ou correspondência com o endereço do cliente.
- "Perguntas entrevista": o roteiro/questionário da entrevista (prints do sistema com perguntas numeradas).
- "outro": qualquer coisa que não se encaixe (deixe em "Revisar").

Para cada arquivo você recebe um trecho do texto (quando o PDF tem texto) e/ou imagens das primeiras páginas. Vários arquivos de imagem podem ser partes do mesmo documento (ex.: "RG frente" e "RG verso", ou várias fotos da CTPS): nesse caso, dê o mesmo tipo a todos e use o campo "grupo" com um mesmo identificador e "ordem" com a sequência das páginas (frente = 1, verso = 2).

Regras:
- Não chute: se não der para saber, use "outro".
- Um arquivo só pode ter um tipo.
- Responda SOMENTE no formato JSON pedido, com uma entrada para cada arquivo, usando exatamente o "id" informado.

ARQUIVOS:
${itens}`;
