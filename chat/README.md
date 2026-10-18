# Decide Aí

Protótipo em React + TypeScript com dois chats em formato de celular: **Cliente** e **Restaurante**. O cliente pode enviar texto, áudio com transcrição local e imagens salvas na pasta `temp`; o restaurante recebe insights semanais do Decide Aí em mensagens de texto. As mensagens do cliente são respondidas por um agente local (Claude Code + MCP do iFood) com textos e recomendações reais de produtos. Não conecta com o WhatsApp.

## Rodar

Requer Node.js 20.19+ ou 22.12+. Para instalar o transcritor, use Python 3.10 a 3.13.

```sh
npm install
npm run setup:audio
npm run dev
```

`setup:audio` cria um ambiente Python isolado em `.venv`, instala faster-whisper e baixa o modelo `base` em `.models`. É necessário acesso à internet nesta instalação. Depois disso, a transcrição roda na CPU do computador que hospeda o chat, sem chave, sem cobrança por chamada e sem enviar o áudio para uma API externa. O modelo ainda usa IA, executada localmente. Não é necessário instalar FFmpeg separadamente.

O ambiente e o modelo já foram preparados nesta máquina. Se o servidor estava aberto antes da alteração, reinicie com `npm run dev` para carregar o endpoint de transcrição. `.env.example` contém apenas opções locais; copiá-lo para `.env` é opcional. Não é necessária uma chave da OpenAI. Se a instalação não encontrar um Python compatível, instale Python 3.12 ou defina `PYTHON_EXECUTABLE` com seu caminho.

Abra a URL mostrada pelo Vite. No computador, os chats de cliente e restaurante aparecem lado a lado, com os títulos acima. Em telas pequenas, ficam um abaixo do outro, mantendo o formato de celular.

Para acessar de outro aparelho na mesma rede, encerre o servidor atual e execute:

```sh
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

No outro aparelho, abra `http://IPV4-DO-SEU-COMPUTADOR:5173/`. Mantenha o servidor rodando e permita acesso do Node.js em redes privadas se o Firewall do Windows solicitar. Cada navegador mantém sua própria conversa.

```sh
npm run build
npm run preview
npm test
```

Tanto `dev` quanto `preview` disponibilizam `/api/transcriptions` e `/api/images` pelo middleware Node do Vite. A pasta `dist` sozinha não contém esses endpoints: servir apenas arquivos estáticos não habilita a transcrição nem o salvamento de imagens. Em uma implantação futura, reutilize os módulos de `server/` em um backend Node com Python e o modelo instalados para áudio.

## Agente (Claude + iFood)

O endpoint `/api/agent` (`server/agent.mjs`) recebe o payload do trigger e roda o **Claude Code desta máquina** em modo headless (`claude -p`). Ele já tem o MCP do iFood autenticado, então não é preciso chave de API nem OAuth no projeto.

Requisitos: `claude` instalado e logado, e `claude mcp list` mostrando `iFood ... ✔ Connected`.

- Cada conversa do chat vira uma sessão do Claude (`--session-id` e depois `--resume`), e o agente lembra o que já buscou.
- **Pedido passo a passo, com envio simulado.** O agente usa o MCP do iFood de verdade para escolher o item e as opções, confirmar ou cadastrar o endereço (`createAddress`), montar o carrinho, escolher a entrega e o pagamento, e mostrar o resumo com os totais do `getCart`. Só a etapa final é simulada: quando o cliente confirma, o servidor gera um comprovante com número `DA-XXXXXX`, avisando que nada foi enviado ao restaurante nem cobrado.
- **`submitOrder` nunca é chamado.** Ele fica fora das ferramentas do modelo (`--disallowedTools`), tudo que não está liberado é negado (`--permission-mode dontAsk`), e o servidor encerra o processo se o modelo tentar chamá-lo.
- O carrinho e o endereço são reais e ficam na conta do iFood. Endereços de teste podem ser removidos pelo app.
- Cada resposta do agente informa `step` (`chat`, `review` ou `confirmed`). Na revisão, o servidor guarda o carrinho, e o comprovante sai mesmo que o modelo não repita os dados ao confirmar.
- Avisos de etapa no chat: "Vou buscar a melhor opção…", "Montando seu carrinho 🛒" e "Conferindo entrega e pagamento 💳".
- Imagens enviadas pelo cliente são lidas da pasta `temp` (ferramenta `Read`, restrita a essa pasta) para buscar pratos parecidos.
- A resposta usa saída estruturada (`--json-schema`) no contrato de `docs/agent-messages.md`. O servidor também remove campos inválidos, como URLs que não são http(s), notas fora de 0 a 5 e IDs repetidos.
- **Localização:** ao abrir o chat, o navegador pede permissão para usar a localização, e ela segue junto com cada mensagem. Se o cliente negar, ou se a página estiver em HTTP por IP da rede (o GPS exige HTTPS ou localhost), o agente pede o endereço no chat e o converte em coordenadas pelo OpenStreetMap (Nominatim, única URL liberada para o `WebFetch`). `USER_LATITUDE` e `USER_LONGITUDE` no `.env` são um fallback opcional.
- **Dúvidas:** se o pedido for vago ("tô com fome"), o agente faz uma pergunta curta antes de buscar. Se der para buscar ("açaí", "pizza barata"), ele busca direto.
- **Aviso de busca:** quando o agente começa a consultar o iFood, o chat recebe na hora a mensagem "Só um instante! Vou buscar a melhor opção pra você no iFood 🔎". `/api/agent` responde em NDJSON (`status`, depois `reply` ou `error`).
- **Três escolhas:** cada recomendação traz até 3 produtos, com legendas que começam por "Escolha 1", "Escolha 2" e "Escolha 3". O cliente pode responder "quero a 2".
- `CLAUDE_MODEL=haiku` (padrão) responde em cerca de 10 a 20 s. `sonnet` dá respostas mais caprichadas, mas é mais lento.
- O console do Vite registra `[agent:reply]` com o tempo, o número de turnos e o custo de cada resposta.

Funciona apenas enquanto este computador estiver rodando `npm run dev`. Ele atende bem a uma demonstração, mas não foi feito para muitos usuários simultâneos.

## Insights para restaurantes

O chat **Restaurante** já mostra um resumo semanal ilustrativo enviado pelo Decide Aí, com o exemplo de procura por açaí após a 1h e a sugestão de estender o horário de atendimento. O restaurante pode responder; o console registra `[restaurant:message:sent]`. Os históricos de cliente e restaurante são separados.

O recebimento de novos resumos está preparado em `window.restaurantChat.receiveWeeklyInsight(resumo)`, com identificação do restaurante e prevenção de reenvios duplicados. Consulte **[o contrato e os limites desta etapa](docs/restaurant-insights.md)**. A geração dos insights, o agendamento semanal e o envio real ao WhatsApp ainda não estão conectados.

## Imagens

- Clique em **Anexar imagem**, confira a prévia, escreva uma legenda opcional e clique em **Enviar imagem**.
- São aceitas imagens JPG, PNG e WebP de até 5 MB.
- O servidor salva o arquivo original em `chat/temp/<identificador-único>.<extensão>`. A pasta é criada automaticamente e fica fora do Git.
- A imagem aparece na conversa; clique nela para abrir em tamanho original. O histórico mantém o endereço e a legenda após atualizar a página.
- O console registra `[chat:image:saved]` com o caminho relativo, e o trigger recebe `message.type === 'image'` e `message.image` com `id`, `url`, `relativePath`, `mimeType`, `size` e `originalName`. `message.content` contém a legenda.
- A integração com o Haiku pode usar `relativePath` para ler os bytes no servidor. O endereço local da imagem não é acessível à API do Haiku diretamente pela internet; a integração futura deverá enviar os bytes da imagem.
- Iniciar uma nova conversa limpa o histórico do navegador, mas preserva as imagens na pasta `temp`. Os arquivos não são apagados automaticamente.
- Se a pasta for movida ou os arquivos forem removidos, as respectivas imagens deixam de aparecer no histórico.

O recurso **Anexar áudio** foi removido. A gravação pelo microfone e a transcrição local continuam disponíveis.

## Áudio e transcrição

- Clique em **Gravar áudio**, conclua, ouça a prévia e clique em **Enviar áudio**. É possível cancelar ou descartar antes do envio.
- Gravações têm até 1 minuto. O endpoint de transcrição aceita até 20 MB e 2 minutos de áudio decodificado.
- A conversa mostra o player e o estado da transcrição. Falhas permitem tentar novamente sem duplicar a mensagem.
- Os arquivos ficam no IndexedDB do navegador, separados do histórico no localStorage. Ao iniciar uma nova conversa, os áudios anteriores são removidos.
- Atualizar a página durante uma transcrição mantém o áudio com a opção de tentar novamente.
- A transcrição atende uma tarefa por vez, com até três áudios entre execução e fila. O tempo de espera no servidor é de 150 segundos.

Abra o console do navegador (F12 → Console) para ver o resultado:

```text
[chat:audio:transcribed] Quero uma pizza de queijo
```

O texto também fica em `message.content` e segue para o trigger existente depois da transcrição. O trigger de áudio só é acionado quando houver uma transcrição bem-sucedida. O agente responde ao texto transcrito como a qualquer outra mensagem.

**Microfone:** a gravação no navegador requer `localhost` ou HTTPS e permissão para usar o microfone. Ao acessar por IP usando HTTP, configure HTTPS para gravar. O envio de imagens funciona normalmente por HTTP na rede local. O modelo de transcrição roda no computador do servidor; seu amigo não precisa instalar Python nem o modelo.

O modelo padrão `base` prioriza leveza. Para melhorar o reconhecimento, configure `WHISPER_MODEL=small` no `.env`, execute `npm run setup:audio` e reinicie o servidor. `small` exige mais memória e processamento. As transcrições podem conter erros; o áudio original continua reproduzível.

Referência do transcritor: https://github.com/SYSTRAN/faster-whisper

## Trigger de envio

Edite `src/services/agent.ts`. A função `onMessageSent(payload)` é chamada uma vez por mensagem de texto enviada, após salvar uma imagem ou após concluir a transcrição de um áudio. Ela ativa o indicador de digitação, envia o payload abaixo para `/api/agent` e devolve a resposta do agente ao chat:

```ts
{
  conversationId: string,
  message: { id, role, content, createdAt, type?, audio?, image? },
  history: Message[]
}
```

`createdAt` usa ISO 8601. O histórico inclui a mensagem atual e exclui áudios ainda sem transcrição bem-sucedida. Mensagens de áudio têm `type: 'audio'`, `content` com o texto reconhecido e `audio` com os metadados. A conversa começa vazia e o usuário envia a primeira mensagem. Enter envia, Shift+Enter quebra a linha. Mensagens vazias são ignoradas. As sugestões enviam o texto exibido.

## Respostas do agente

O chat já aceita respostas de texto e recomendações com foto, nome, restaurante, nota, preço, frete e prazo. Cada produto aparece como uma mensagem de foto com legenda comum, sem carrossel ou layout personalizado de catálogo. Consulte **[o contrato JSON, as regras de compatibilidade com WhatsApp e os exemplos](docs/agent-messages.md)** para integrar o agente. Valores monetários são inteiros em centavos. Dados não informados não são inventados.

Para conferir o visual com dados fictícios, abra `http://localhost:5173/?preview=products`. Use os botões **Texto**, **1 produto** e **Vários produtos** para testar sem console. A prévia não altera o histórico da conversa principal.

Opção 1: retornar uma string ou um objeto `AgentResponse` em `onMessageSent`. A interface o adicionará à conversa. Respostas de chamadas antigas são ignoradas se a conversa tiver sido reiniciada.

Opção 2: receber a resposta separadamente e chamar a ponte pública. Para testar no console do navegador:

```js
window.chat.setTyping(true)
window.chat.receiveMessage('Oi! Sua resposta apareceu aqui 🍔')
```

Para testar as recomendações, após iniciar a conversa como usuário:

```js
const resposta = await fetch('/examples/products.json').then(r => r.json());
window.chat.receiveAgentMessage(resposta);
```

`receiveMessage` e `receiveAgentMessage` aceitam texto ou um objeto JSON já desserializado, adicionam a mensagem do assistente, salvam o histórico e encerram o indicador de digitação. Não disparam o trigger de envio. A ponte ignora respostas cujo `conversationId`, quando informado, não corresponda à conversa atual. O campo opcional `messageId` evita duplicar uma resposta reenviada.

O protótipo não tem saudação inicial: o agente só responde depois que o cliente envia uma mensagem. Envie uma mensagem como usuário antes de testar a resposta pela ponte; respostas recebidas antes disso são ignoradas. Históricos da versão anterior mantêm as mensagens do usuário e removem apenas a antiga saudação automática.

## Organização

- `src/App.tsx`: disposição dos dois chats e fluxo da conversa do cliente.
- `src/components/RestaurantChat.tsx`: conversa do restaurante e recebimento de insights.
- `src/services/restaurantInsights.ts`: validação e exemplo dos resumos semanais.
- `docs/restaurant-insights.md`: contrato e integração dos insights.
- `src/workspace.css`: disposição dos celulares lado a lado e adaptação a telas pequenas.
- `src/components/`: componentes visuais.
- `src/services/agent.ts`: trigger que envia as mensagens ao agente.
- `server/agent.mjs`: endpoint `/api/agent`, que chama o Claude Code com o MCP do iFood.
- `src/services/storage.ts`: histórico local e criação de mensagens.
- `src/services/audio.ts`: validação de áudio e chamada ao backend local.
- `src/services/audioStorage.ts`: arquivos no IndexedDB.
- `src/components/AudioComposer.tsx`: gravação, prévia e anexos.
- `src/components/AudioMessage.tsx`: player e estado da transcrição.
- `src/components/ImageComposer.tsx`: seleção, prévia e envio da imagem.
- `src/components/ImageMessage.tsx`: imagem e legenda na conversa.
- `src/components/ProductRecommendations.tsx`: recomendações em mensagens de foto com legenda.
- `src/services/whatsappFormatting.ts`: legendas e divisão de textos comuns para emular o WhatsApp.
- `src/services/agentMessages.ts`: validação do formato das respostas do agente.
- `public/agent-response.schema.json`: JSON Schema do contrato.
- `public/examples/`: exemplos de texto, produto único e lista de produtos, com ilustrações locais.
- `docs/agent-messages.md`: instruções e contrato para integrar o agente.
- `src/services/images.ts`: validação e upload de imagem.
- `server/images.mjs`: salvamento na pasta `temp` e leitura das imagens.
- `server/transcription.mjs`: validação e endpoint HTTP.
- `server/local-transcriber.mjs`: fila e execução do transcritor Python.
- `server/transcribe.py`: Whisper em português na CPU.
- `scripts/setup-audio.mjs`: instalação do ambiente e do modelo.
- `tests/`: verificações de uploads, transcrição, erros e histórico.
- `src/types.ts`: contrato de mensagens e integração.
- `src/styles.css`: visual e adaptação ao celular.

O histórico fica no localStorage deste navegador. O menu de três pontos permite iniciar uma nova conversa após confirmação. Em caso de falha no armazenamento, a conversa de texto continua em memória. Áudios exigem IndexedDB disponível. Há um endpoint local de transcrição, sem autenticação; use em um ambiente local confiável. A fonte externa é opcional e há fontes locais de fallback.
