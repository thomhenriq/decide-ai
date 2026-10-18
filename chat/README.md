# Decide Aí

Protótipo mobile em React + TypeScript. Uma conversa, mensagens de texto, áudio com transcrição local, imagens salvas na pasta `temp` e um ponto de integração para o agente. Não conecta com WhatsApp nem iFood.

## Rodar

Requer Node.js 20.19+ ou 22.12+. Para instalar o transcritor, use Python 3.10 a 3.13.

```sh
npm install
npm run setup:audio
npm run dev
```

`setup:audio` cria um ambiente Python isolado em `.venv`, instala faster-whisper e baixa o modelo `base` em `.models`. É necessário acesso à internet nesta instalação. Depois disso, a transcrição roda na CPU do computador que hospeda o chat, sem chave, sem cobrança por chamada e sem enviar o áudio para uma API externa. O modelo ainda usa IA, executada localmente. Não é necessário instalar FFmpeg separadamente.

O ambiente e o modelo já foram preparados nesta máquina. Se o servidor estava aberto antes da alteração, reinicie com `npm run dev` para carregar o endpoint de transcrição. `.env.example` contém apenas opções locais; copiá-lo para `.env` é opcional. Não é necessária uma chave da OpenAI. Se a instalação não encontrar um Python compatível, instale Python 3.12 ou defina `PYTHON_EXECUTABLE` com seu caminho.

Abra a URL mostrada pelo Vite. No computador, a interface mantém o formato de celular; em telas pequenas, ocupa a tela inteira.

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

O texto também fica em `message.content` e segue para o trigger existente depois da transcrição. O trigger de áudio só é acionado quando houver uma transcrição bem-sucedida. Não são geradas respostas automáticas.

**Microfone:** a gravação no navegador requer `localhost` ou HTTPS e permissão para usar o microfone. Ao acessar por IP usando HTTP, configure HTTPS para gravar. O envio de imagens funciona normalmente por HTTP na rede local. O modelo de transcrição roda no computador do servidor; seu amigo não precisa instalar Python nem o modelo.

O modelo padrão `base` prioriza leveza. Para melhorar o reconhecimento, configure `WHISPER_MODEL=small` no `.env`, execute `npm run setup:audio` e reinicie o servidor. `small` exige mais memória e processamento. As transcrições podem conter erros; o áudio original continua reproduzível.

Referência do transcritor: https://github.com/SYSTRAN/faster-whisper

## Trigger de envio

Edite `src/services/agent.ts`. A função `onMessageSent(payload)` é chamada uma vez por mensagem de texto enviada, após salvar uma imagem ou após concluir a transcrição de um áudio. Hoje apenas registra o conteúdo ou os metadados da imagem no console, junto com o objeto completo:

```ts
{
  conversationId: string,
  message: { id, role, content, createdAt, type?, audio?, image? },
  history: Message[]
}
```

`createdAt` usa ISO 8601. O histórico inclui a mensagem atual e exclui áudios ainda sem transcrição bem-sucedida. Mensagens de áudio têm `type: 'audio'`, `content` com o texto reconhecido e `audio` com os metadados. A conversa começa vazia e o usuário envia a primeira mensagem. Enter envia, Shift+Enter quebra a linha. Mensagens vazias são ignoradas. As sugestões enviam o texto exibido.

## Respostas do agente

Opção 1: retornar o texto da resposta em `onMessageSent`. A interface o adicionará à conversa. Respostas de chamadas antigas são ignoradas se a conversa tiver sido reiniciada.

Opção 2: receber a resposta separadamente e chamar a ponte pública. Para testar no console do navegador:

```js
window.chat.setTyping(true)
window.chat.receiveMessage('Oi! Sua resposta apareceu aqui 🍔')
```

`receiveMessage` adiciona a mensagem do assistente, salva o histórico e encerra o indicador de digitação. Ela não dispara o trigger de envio. A ponte recebe respostas para a conversa aberta no momento da chamada; na integração assíncrona, confira o conversationId antes de entregar respostas antigas.

O protótipo não gera respostas automáticas nem saudação inicial. Envie uma mensagem como usuário antes de testar a resposta pela ponte; respostas recebidas antes disso são ignoradas. Históricos da versão anterior mantêm as mensagens do usuário e removem apenas a antiga saudação automática.

## Organização

- `src/App.tsx`: fluxo da conversa, formulário e ponte pública.
- `src/components/`: componentes visuais.
- `src/services/agent.ts`: trigger para integrar o agente.
- `src/services/storage.ts`: histórico local e criação de mensagens.
- `src/services/audio.ts`: validação de áudio e chamada ao backend local.
- `src/services/audioStorage.ts`: arquivos no IndexedDB.
- `src/components/AudioComposer.tsx`: gravação, prévia e anexos.
- `src/components/AudioMessage.tsx`: player e estado da transcrição.
- `src/components/ImageComposer.tsx`: seleção, prévia e envio da imagem.
- `src/components/ImageMessage.tsx`: imagem e legenda na conversa.
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
