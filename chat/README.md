# Decide Aí

Protótipo mobile em React + TypeScript. Uma conversa, mensagens de texto e um ponto de integração para o agente. Não conecta com WhatsApp nem iFood.

## Rodar

Requer Node.js 20.19+ ou 22.12+.

```sh
npm install
npm run dev
```

Abra a URL mostrada pelo Vite. No computador, a interface mantém o formato de celular; em telas pequenas, ocupa a tela inteira.

Para acessar de outro aparelho na mesma rede, encerre o servidor atual e execute:

```sh
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

No outro aparelho, abra `http://IPV4-DO-SEU-COMPUTADOR:5173/`. Mantenha o servidor rodando e permita acesso do Node.js em redes privadas se o Firewall do Windows solicitar. Cada navegador mantém sua própria conversa.

```sh
npm run build
npm run preview
```

## Trigger de envio

Edite `src/services/agent.ts`. A função `onMessageSent(payload)` é chamada uma vez por mensagem enviada e hoje apenas registra no console o texto e o objeto completo:

```ts
{
  conversationId: string,
  message: { id, role, content, createdAt },
  history: Message[]
}
```

`createdAt` usa ISO 8601. O histórico inclui a mensagem recém-enviada. A conversa começa vazia e o usuário envia a primeira mensagem. Enter envia, Shift+Enter quebra a linha. Mensagens vazias são ignoradas. As sugestões enviam o texto exibido.

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
- `src/types.ts`: contrato de mensagens e integração.
- `src/styles.css`: visual e adaptação ao celular.

O histórico fica no localStorage deste navegador. O menu de três pontos permite iniciar uma nova conversa após confirmação. Em caso de falha no armazenamento, a conversa continua em memória. Não há backend nem autenticação. Ao conectar o agente, mantenha credenciais privadas em um backend. A fonte externa é opcional e há fontes locais de fallback.
