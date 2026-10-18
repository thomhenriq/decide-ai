# Chat do restaurante

A página apresenta dois celulares: **Cliente** e **Restaurante**. No celular, aparece um painel por vez: um gesto vertical longo troca de painel instantaneamente, sem efeito de rolagem. A rolagem do histórico tem prioridade sobre a troca de painel. O cliente continua iniciando sua própria conversa; no restaurante, o Decide Aí inicia enviando o resumo semanal. São históricos independentes, inclusive depois de atualizar a página. O modo `?preview=products` não lê nem salva o histórico de nenhum dos dois painéis.

A conversa começa com uma saudação (`RESTAURANT_WELCOME` em `src/services/restaurantInsights.ts`) que explica como pedir os insights. Os insights são calculados a partir das buscas registradas no banco; veja "Inteligência de demanda" no README. As mensagens usam texto comum, com observação e sugestão de ação, compatível com a apresentação de uma conversa no WhatsApp. Não há gráficos, cartões ou botões especiais dentro da mensagem.

## Receber um resumo real no futuro

O sistema que analisar as conversas e executar a rotina semanal poderá entregar este contrato interno à interface:

```json
{
  "type": "weekly_insight",
  "restaurantId": "restaurante-demo",
  "messageId": "resumo-restaurante-demo-2026-W42",
  "text": "Seu resumo da semana chegou!\n\nHouve uma grande procura por açaí após a 1h. Seu estabelecimento fecha às 00h30.\n\nConsidere testar um horário de fechamento mais tarde."
}
```

Depois de receber o JSON no frontend, a integração chama `window.restaurantChat.receiveWeeklyInsight(resumo)`. O retorno é `true` quando aceito ou já recebido, e `false` quando inválido ou destinado a outro restaurante. A mensagem pode iniciar a conversa, sem exigir uma mensagem prévia do restaurante. O ID do exemplo é `restaurante-demo`, exportado como `RESTAURANT_ID` em `src/services/restaurantInsights.ts`; substitua-o pelo restaurante autenticado na integração real.

Use um `messageId` estável por resumo semanal, com até 128 caracteres, para não duplicar reentregas enquanto o histórico estiver salvo. `text` aceita até 10000 caracteres; textos longos são divididos em mensagens comuns. O conteúdo é tratado como texto, nunca como HTML.

O restaurante conversa pelo campo de mensagem. A função `onRestaurantMessageSent` em `src/services/agent.ts` envia cada mensagem para `/api/restaurant/agent` (`server/restaurant-agent.mjs`), que responde com os insights da semana quando o restaurante pede, ou com uma resposta curta nos outros casos. Esse fluxo é separado de `onMessageSent`, usado pelo cliente.

## Limite desta entrega

A coleta, a agregação e a geração de insights sob pedido já funcionam neste protótipo. O envio automático semanal (sem o restaurante pedir) e a entrega real pelo WhatsApp ainda precisam de agendamento e integração com o canal. O contrato acima é interno ao protótipo; ele não é um payload da API do WhatsApp. O envio real deverá usar o formato e as regras da integração escolhida, conforme a orientação de compatibilidade em `docs/agent-messages.md`.
