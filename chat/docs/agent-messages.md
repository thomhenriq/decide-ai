# Contrato de mensagens do agente

O chat aceita texto simples, uma recomendação ou até dez produtos por resposta. Cada produto aparece em uma mensagem de imagem com legenda comum contendo nome, restaurante, avaliação, preço, frete e previsão. As opções chegam uma abaixo da outra, como mensagens normais do WhatsApp. Um link, quando fornecido, aparece em uma mensagem de texto separada. O agente continua sendo responsável por escolher o que recomendar e por consultar os MCPs; a interface apresenta os dados recebidos.

## Compatibilidade com WhatsApp

Este projeto emula o WhatsApp. Funcionalidades novas precisam ter uma representação realizável no canal real. O contrato JSON abaixo é interno ao Decide Aí; não é o payload de envio da API do WhatsApp.

O padrão usa foto e texto, sem carrossel, botões de navegação, preço com fonte especial ou widgets de avaliação. As informações entram na legenda como texto comum. A descrição pode ser resumida para manter a legenda curta, preservando preço, restaurante, avaliação e entrega; o objeto original do produto continua no histórico. Textos longos são apresentados como mensagens consecutivas.

Há formatos específicos de carrossel e catálogo em integrações WhatsApp Business. Só adote esses formatos depois de definir a integração real, confirmar seus requisitos e reproduzir seu layout e comportamento suportados. Não presuma que qualquer HTML do protótipo pode ser enviado ao WhatsApp.

Os botões de simulação ficam exclusivamente na página de prévia e são ferramentas de teste. Não representam funcionalidades exibidas ao cliente no WhatsApp.

## Prévia

Com o servidor iniciado, abra `http://localhost:5173/?preview=products`. A faixa superior identifica os dados e imagens como ilustrativos. Use os botões **Texto**, **1 produto** e **Vários produtos** para simular a chegada de respostas sem abrir o console. Cada clique adiciona uma resposta usando a mesma validação da integração real. Essa prévia não lê nem grava o histórico da sua conversa principal. Fora dessa URL, não há recomendações automáticas ou saudação inicial. **Voltar ao chat** abre a conversa principal.

Os exemplos completos ficam em `public/examples/text.json`, `product.json` e `products.json`. As ilustrações SVG desses exemplos são apenas demonstrações. Na integração real, use a foto do catálogo e um formato de mídia aceito pela API do WhatsApp selecionada.

## Resposta de texto

```json
{
  "type": "text",
  "text": "Você prefere hambúrguer ou pizza hoje?"
}
```

Uma string simples continua funcionando com o mesmo resultado.

## Recomendação de produto

```json
{
  "type": "products",
  "text": "Encontrei uma opção que combina com seu pedido:",
  "products": [
    {
      "id": "produto-123",
      "name": "Burger da casa",
      "description": "Pão brioche, hambúrguer, queijo e salada.",
      "imageUrl": "https://seu-catalogo.example/fotos/burger.jpg",
      "priceCents": 2990,
      "originalPriceCents": 3490,
      "restaurant": {
        "id": "restaurante-456",
        "name": "Quintal Burger",
        "rating": 4.8,
        "ratingCount": 248
      },
      "delivery": {
        "feeCents": 0,
        "minMinutes": 25,
        "maxMinutes": 40
      }
    }
  ]
}
```

O endereço `seu-catalogo.example` é apenas um exemplo do contrato. Substitua pela foto real retornada pelo catálogo. Para várias opções, adicione objetos ao mesmo array `products`.

## Campos

| Campo | Regra |
| --- | --- |
| `type` | `text` ou `products`. |
| `text` | Obrigatório e não vazio para `text`; legenda opcional para `products`. Até 10.000 caracteres. |
| `products` | De 1 a 10 produtos. Cada `id` deve ser diferente na mesma resposta. |
| `id`, `name`, `restaurant.name` | Obrigatórios em cada produto. Use IDs estáveis do catálogo. |
| `imageUrl` | Foto acessível ao navegador por HTTP/HTTPS ou caminho local começando com `/`. Ausência ou falha de carregamento mostra uma indicação de foto indisponível. |
| `priceCents` | Preço em **centavos inteiros**: `2990` significa R$ 29,90. Sem esse campo, aparece “Preço não informado”. |
| `originalPriceCents` | Opcional. Quando maior que o preço atual, entra como “Preço anterior” na legenda. |
| `restaurant.rating` | Número de 0 a 5, referente ao restaurante. Não envie texto como `"4,8"`. Ausência mostra “Nota não informada”. |
| `restaurant.ratingCount` | Quantidade inteira de avaliações. Opcional. |
| `delivery.feeCents` | Frete em centavos. `0` significa entrega grátis. Ausência mostra “Frete a consultar”. |
| `delivery.minMinutes`, `maxMinutes` | Inteiros de 0 a 1.440; o mínimo não pode ser maior que o máximo. Ausência mostra “Prazo a consultar”. |
| `url` | Opcional. URL real da opção no catálogo ou restaurante; aparece como link em uma mensagem de texto separada, sem criar um botão de compra. |
| `conversationId` | Opcional no topo da resposta. Recomendado: repita o ID recebido no trigger para impedir que uma resposta antiga entre em outra conversa. |
| `messageId` | Opcional no topo da resposta. Recomendado: ID único e estável da resposta, para não duplicá-la em reenvios. |

Valores monetários usam BRL. Campos opcionais sem informação devem ser omitidos; não envie `null`, strings vazias ou valores inventados. URLs `javascript:`, `data:`, arquivos locais e URLs com credenciais são rejeitadas. Nome e descrição são tratados como texto, sem executar HTML.

O JSON Schema está em `public/agent-response.schema.json`. Além do schema, a validação em tempo de execução confere IDs duplicados, URLs e a relação entre os prazos.

## Entregar a resposta ao chat

**Pelo trigger existente:** retorne uma string ou o objeto descrito acima em `onMessageSent`, em `src/services/agent.ts`. O chat já sabe renderizar ambos. Na futura integração, desserialize a resposta JSON do backend antes de retorná-la.

**Pela ponte pública:** depois de enviar uma mensagem como usuário, execute no console do navegador:

```js
const resposta = await fetch('/examples/products.json').then(r => r.json());
window.chat.receiveAgentMessage(resposta);
```

`window.chat.receiveMessage(resposta)` também funciona. Para texto simples:

```js
window.chat.receiveMessage('Encontrei algumas opções para você.');
```

A ponte recebe o **objeto JSON já desserializado**, não uma string contendo JSON. Ela retorna `true` quando aceita ou já recebeu aquela `messageId`, e `false` se o usuário ainda não iniciou a conversa, o formato for inválido ou o `conversationId` for de outra conversa. Dados inválidos também são descritos no console com `[chat:agent:invalid]`.

As mensagens recebidas não disparam novamente o trigger de envio. `window.chat.setTyping(true)` pode ser usado enquanto espera; o indicador é encerrado quando chega uma resposta válida. Mensagens de produto são mantidas no histórico do navegador junto com textos, imagens e áudios.

Esses caminhos preparam a apresentação e a entrega das mensagens no frontend. A conexão efetiva com o Haiku e os MCPs continua no adaptador/backend do agente.
