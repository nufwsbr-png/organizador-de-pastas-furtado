/** Prompts em português usados pelas etapas que chamam a IA. */

export const PROMPT_PERGUNTAS = (imagens: string[], texto = '') => `Você está lendo as páginas de um PDF com o roteiro de uma entrevista trabalhista. Ele vem em um destes formatos:
- prints de um sistema, com as perguntas numeradas (01, 02, ...), títulos "Seção · ..." e botões "Sim / Não";
- um documento "Entrevista guiada", com um cabeçalho de dados do cliente (NOME DO CLIENTE, TELEFONE, NOME DA EMPRESA...), títulos de seção em maiúsculas e as perguntas numeradas dentro de cada seção, cada uma seguida de "R:" com a resposta.

As páginas estão nestas imagens, em ordem:

${imagens.map((i, n) => `${n + 1}. ${i}`).join('\n')}

Leia TODAS as imagens com atenção e extraia:
1. A lista completa de perguntas, na ordem, com a seção a que pertence, se a pergunta tem os botões "Sim / Não" (simNao = true) ou só o campo de texto (simNao = false) e, em respostaNoPdf, a resposta que já está escrita no documento (o texto depois de "R:"), copiada como está. Deixe respostaNoPdf vazio quando não houver resposta escrita ou ela for só um ponto ou um traço.
2. Os dados do cliente que aparecem no documento (no painel "Cliente em entrevista" ou no cabeçalho): nome, telefone, empresa, CNPJ e endereço da empresa, cargo, vínculo, salário e datas de admissão e de demissão, quando existirem.

Regras:
- Copie o texto de cada pergunta exatamente como está, sem resumir.
- O cabeçalho de dados do cliente não é pergunta; as perguntas são só as numeradas.
- Se o título da seção de uma pergunta não aparecer na página (a página começa no meio da seção), use o título da última seção vista; se nenhum título apareceu ainda, use "Entrevista". Nunca escreva observações no campo secao.
- Não invente perguntas; se uma página estiver ilegível, pule-a.
- Numere as perguntas em sequência contínua no documento inteiro (1, 2, 3, ...), mesmo quando o documento recomeça a numeração em cada seção.
- Responda SOMENTE no formato JSON pedido.${
  texto
    ? `

Texto extraído do mesmo PDF (use para conferir a grafia; a ordem e a estrutura são as das imagens):
${texto}`
    : ''
}`;

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
- Pergunta marcada "já respondida no documento": repita essa resposta (ela vem do cadastro e não muda).
- Em outrasPerguntas, escreva a pergunta como a atendente fez (resumida se for longa) e a resposta nas mesmas regras acima; não inclua cumprimentos, confirmação de dados cadastrais nem perguntas sem resposta.
- Responda SOMENTE no formato JSON pedido, com uma entrada em respostas para cada pergunta da lista.

PERGUNTAS:
${perguntas}

TRANSCRIÇÃO DA LIGAÇÃO:
${transcricao}`;

export interface EntradaEmpresa {
  hoje: string;
  documento: string;
  transcricao: string;
  conversa: string;
  ctpsTexto: string;
  ctpsImagens: string[];
}

export const PROMPT_EMPRESA = (e: EntradaEmpresa) => `Você é assistente de um escritório de advocacia trabalhista. Identifique, com certeza, a empresa contra a qual o cliente vai entrar com o processo e se o caso tem empresa tomadora de serviços (trabalho terceirizado). Hoje é ${e.hoje}.

QUAL É A EMPRESA DO CASO. Use as fontes nesta ordem:
1. O documento da entrevista (dados já preenchidos no cadastro).
2. A ligação da entrevista (transcrição): a empresa que a atendente analisou com o cliente.
3. A conversa do WhatsApp com o escritório.
A CTPS (carteira de trabalho) confirma o nome exato (razão social), o CNPJ, o cargo e as datas de admissão e saída.

RÉGUA DO ESCRITÓRIO: a empresa só serve para o caso se o cliente saiu dela há MENOS de 2 anos (ou ainda trabalha lá) E trabalhou nela MAIS de 6 meses.

Cuidados obrigatórios:
- O cliente às vezes cita no WhatsApp uma empresa que não se encaixa na régua (saiu há mais de 2 anos, ficou 6 meses ou menos) e o escritório passa a analisar outra. Nunca escolha uma empresa só porque foi citada: confira a régua com as datas.
- Confira na CTPS: a empresa do caso deve aparecer num contrato com datas compatíveis com o que o cliente contou. Use o nome como está na CTPS.
- Se mais de uma empresa se encaixa na régua e as fontes não dizem qual é a do caso, não escolha por conta própria: preencha a mais provável e marque certeza = false.
- certeza = true só quando as fontes apontam para a mesma empresa e ela se encaixa na régua.
- confirmadaNaCtps = true só se você viu essa empresa num contrato da CTPS.
- Não invente nome, CNPJ, endereço nem datas: copie do que está escrito nas fontes; o que não houver, null. Datas no formato DD/MM/AAAA.
- Em fontes, marque onde cada empresa aparece: "entrevista", "ligacao", "whatsapp", "ctps".
- Em descartadas, liste as empresas citadas que você descartou e o motivo em poucas palavras (ex.: "saiu em 2021, mais de 2 anos").

TERCEIRIZAÇÃO:
- terceirizado = true quando o cliente era empregado de uma empresa (a empregadora, que presta serviços) e trabalhava dentro de outra empresa ou para outra (a tomadora). Exemplos: vigilância, limpeza, portaria, manutenção, call center, terceirizado de banco, loja, fábrica ou hospital; o cliente diz que "prestava serviço para", "trabalhava dentro da" ou "era terceirizado"; o local de trabalho é de outra empresa. Só marque com indício claro nas fontes.
- Em tomadora, os dados da empresa tomadora que aparecem nas fontes (nome, CNPJ, endereço); o que não houver, null. Sem terceirização, tomadora com tudo null e fontes vazia.

Em justificativa, escreva de 1 a 3 frases curtas: qual é a empresa do caso e por quê e, se for o caso, por que é terceirizado.

Responda SOMENTE no formato JSON pedido.

DOCUMENTO DA ENTREVISTA:
${e.documento}

TRANSCRIÇÃO DA LIGAÇÃO:
${e.transcricao || '(sem transcrição)'}

CONVERSA DO WHATSAPP:
${e.conversa || '(conversa não disponível)'}

CTPS:
${
  e.ctpsImagens.length > 0
    ? `As páginas da CTPS estão nestas imagens, em ordem:\n${e.ctpsImagens.map((i, n) => `${n + 1}. ${i}`).join('\n')}`
    : e.ctpsTexto || '(a CTPS não está na pasta)'
}`;

export const PROMPT_CLASSIFICAR = (itens: string) => `Você organiza a pasta de um cliente de um escritório de advocacia trabalhista. Cada arquivo abaixo precisa ser classificado em um destes tipos:

- "Procuração": procuração ad judicia / instrumento de mandato para os advogados.
- "Declaração": declaração de hipossuficiência / de pobreza / para justiça gratuita.
- "RG": documento de identidade (RG, carteira de identidade, CIN). Frente e verso são o MESMO documento.
- "CNH": carteira nacional de habilitação (usada como identidade quando não há RG).
- "CTPS": carteira de trabalho (física ou digital), incluindo as páginas de contrato de trabalho.
- "Contrato Trabalhista": contrato de honorários / contrato de prestação de serviços advocatícios entre o cliente e o escritório.
- "Comprovante de residência": conta de luz, água, telefone, internet, fatura ou correspondência com o endereço do cliente.
- "Perguntas entrevista": o roteiro/questionário da entrevista (prints do sistema com perguntas numeradas).
- "outro": qualquer coisa que não se encaixe (laudos, holerites, prints de conversa, fotos do trabalho etc.).

Para cada arquivo você recebe um trecho do texto (quando o PDF tem texto) e/ou imagens das primeiras páginas. Vários arquivos de imagem podem ser partes do mesmo documento (ex.: "RG frente" e "RG verso", ou várias fotos da CTPS): nesse caso, dê o mesmo tipo a todos e use o campo "grupo" com um mesmo identificador e "ordem" com a sequência das páginas (frente = 1, verso = 2).

Regras:
- Não chute: se não der para saber, use "outro".
- Um arquivo só pode ter um tipo.
- Responda SOMENTE no formato JSON pedido, com uma entrada para cada arquivo, usando exatamente o "id" informado.

ARQUIVOS:
${itens}`;
