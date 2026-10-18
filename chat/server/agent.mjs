import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const MAX_BODY_BYTES = 1024 * 1024;
// O checkout chama várias ferramentas em sequência; damos mais tempo que uma busca simples.
const TIMEOUT_MS = 240_000;
const MAX_CHOICES = 3;
const GEOCODER = 'nominatim.openstreetmap.org';
const ifood = names => names.map(name => `mcp__iFood__${name}`);
const SEARCH_TOOLS = ifood(['searchOffers', 'browseOffers', 'getRecommendations']);
const CART_TOOLS = ifood(['createCart', 'getCart', 'addItemToCart', 'updateCartItem', 'removeItemFromCart']);
const CHECKOUT_TOOLS = ifood(['getCartDeliveryMethods', 'setCartDelivery', 'listPaymentMethods', 'setCartPayment', 'listVouchers', 'setVoucher', 'removeVoucher']);
// Todo o MCP do iFood, menos o envio do pedido: o carrinho é real, o pedido final é simulado.
const IFOOD_TOOLS = [
  ...SEARCH_TOOLS, ...CART_TOOLS, ...CHECKOUT_TOOLS,
  ...ifood(['getMerchant', 'getItem', 'listAddresses', 'createAddress', 'getUser', 'getOrder', 'trackOrder']),
];
const BLOCKED_TOOLS = ifood(['submitOrder']);
// Qualquer chamada fora da lista invalida a resposta e encerra o processo, mesmo que o CLI a tenha negado.
const isAllowedTool = name => IFOOD_TOOLS.includes(name) || ['Read', 'WebFetch', 'StructuredOutput'].includes(name);

// Avisos enviados ao chat, uma vez por etapa, assim que o agente começa a usar aquele grupo de ferramentas.
export const SEARCHING_TEXT = 'Só um instante! Vou buscar a melhor opção pra você no iFood 🔎';
const STATUS_STEPS = [
  { tools: SEARCH_TOOLS, text: SEARCHING_TEXT },
  // getCart só lê o carrinho para a revisão; não anuncia uma nova etapa.
  { tools: CART_TOOLS.filter(name => name !== 'mcp__iFood__getCart'), text: 'Montando seu carrinho 🛒' },
  { tools: CHECKOUT_TOOLS, text: 'Conferindo entrega e pagamento 💳' },
];

/** Aceita apenas coordenadas válidas vindas do navegador. */
function parseLocation(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  return { latitude, longitude };
}

// Versão simplificada de public/agent-response.schema.json; a validação completa continua no frontend.
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'step', 'text'],
  properties: {
    type: { enum: ['text', 'products'] },
    // chat: conversa e busca; review: resumo do carrinho aguardando o "sim"; confirmed: cliente confirmou o pedido.
    step: { enum: ['chat', 'review', 'confirmed'] },
    text: { type: 'string' },
    products: {
      type: 'array', maxItems: MAX_CHOICES,
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'name', 'restaurant'],
        properties: {
          id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
          imageUrl: { type: 'string' }, priceCents: { type: 'integer' }, originalPriceCents: { type: 'integer' }, url: { type: 'string' },
          restaurant: {
            type: 'object', additionalProperties: false, required: ['name'],
            properties: { id: { type: 'string' }, name: { type: 'string' }, rating: { type: 'number' }, ratingCount: { type: 'integer' } },
          },
          delivery: {
            type: 'object', additionalProperties: false,
            properties: { feeCents: { type: 'integer' }, minMinutes: { type: 'integer' }, maxMinutes: { type: 'integer' } },
          },
        },
      },
    },
    // Dados do último getCart, enviados em step "review" e "confirmed". O servidor gera o comprovante simulado.
    order: {
      type: 'object', additionalProperties: false,
      required: ['cartId', 'merchantName', 'items', 'totalCents'],
      properties: {
        cartId: { type: 'string' },
        merchantName: { type: 'string' },
        items: {
          type: 'array', minItems: 1,
          items: {
            type: 'object', additionalProperties: false, required: ['name', 'quantity'],
            properties: { name: { type: 'string' }, quantity: { type: 'integer' }, totalCents: { type: 'integer' }, details: { type: 'string' } },
          },
        },
        subtotalCents: { type: 'integer' },
        deliveryFeeCents: { type: 'integer' },
        serviceFeeCents: { type: 'integer' },
        discountCents: { type: 'integer' },
        totalCents: { type: 'integer' },
        deliveryAddress: { type: 'string' },
        deliveryMethod: { type: 'string' },
        paymentMethod: { type: 'string' },
        minMinutes: { type: 'integer' },
        maxMinutes: { type: 'integer' },
      },
    },
  },
};

function locationInstructions(location) {
  if (location) {
    return `Localização do cliente (GPS do navegador): latitude ${location.latitude}, longitude ${location.longitude}. Use essas coordenadas em userLocation.
Se o cliente pedir para entregar em outro endereço, converta esse endereço em coordenadas (veja abaixo) e use as novas.`;
  }
  return `A localização do cliente NÃO está disponível: ele não autorizou o GPS ou o navegador não permite.
- Se o cliente já informou um endereço nesta conversa e você já obteve as coordenadas, continue usando essas coordenadas.
- Caso contrário, NÃO busque nada: responda com type "text" pedindo o endereço de entrega (rua e número, ou bairro, e cidade).
- Nunca invente ou chute coordenadas.`;
}

function systemPrompt(location) {
  return `Você é o Decide Aí, um assistente no WhatsApp que ajuda o cliente a decidir o que pedir no iFood.
Responda sempre em português do Brasil, de forma curta e simpática, como numa conversa de WhatsApp.

${locationInstructions(location)}

Para converter um endereço em coordenadas, use WebFetch em
https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=<endereço codificado para URL>
e use os campos lat e lon. Se não encontrar ou o resultado for ambíguo, peça ao cliente para confirmar o endereço.

Quando tiver dúvida, pergunte em vez de supor:
- Se o pedido for vago demais para uma boa escolha (por exemplo "tô com fome" ou "qualquer coisa"), faça UMA pergunta curta e objetiva antes de buscar, como "Doce ou salgado?" ou "Tem um orçamento em mente?".
- Se o pedido já der para buscar (por exemplo "pizza barata" ou "açaí"), busque direto, sem perguntar.
- Se a busca não trouxer nada bom, diga isso e sugira um ajuste em vez de recomendar algo que não combina.

Ferramentas de busca do iFood:
- searchOffers com resultKind ITEM quando o cliente descrever o que quer comer. Qualificadores como barato, rápido, frete grátis e bem avaliado vão em refinements. Prefira onlyOpen: true.
- getRecommendations para pedidos como "o que você recomenda", promoções ou favoritos.
- browseOffers para explorar uma categoria sem termo específico.
- getItem e getMerchant quando precisar de detalhes de algo já listado.

Fluxo de pedido, passo a passo, quando o cliente escolher um produto ("quero a 2"):
1. Item: chame getItem. Se houver opções obrigatórias (tamanho, sabor, ponto), pergunte ao cliente antes de seguir. Confirme a quantidade se não for óbvia.
2. Endereço: chame listAddresses. Se houver um endereço salvo provável, confirme brevemente ("Entregar na Casa?"). Se não houver nenhum, peça o endereço completo (rua, número, bairro, cidade e complemento) e salve com createAddress no fluxo de duas etapas, confirmando o candidato com o cliente. Com GPS e sem endereço salvo, você pode sugerir o endereço aproximado obtido em https://nominatim.openstreetmap.org/reverse?format=json&lat=<lat>&lon=<lon>, mas confirme número e complemento.
3. Carrinho: crie com createCart (merchantId, addressId e items com os optionIds escolhidos). Use addItemToCart ou updateCartItem para mudanças.
4. Entrega: chame getCartDeliveryMethods e use setCartDelivery. Se houver só uma opção imediata, use-a e informe; se houver mais de uma, pergunte.
5. Pagamento: chame listPaymentMethods (merchantId do carrinho) e pergunte qual forma o cliente prefere. Depois chame setCartPayment, com cardTokenId apenas para cartão salvo. Se o cliente mencionar cupom, use listVouchers e setVoucher.
6. Revisão: chame getCart e mostre um resumo em texto com itens, subtotal, frete, taxas, descontos, total, endereço, entrega e pagamento, terminando com "Posso confirmar o pedido?". Nessa resposta use step "review" e preencha order com os dados exatos do getCart (totalCents é o total final, com taxas).
7. Confirmação: quando o cliente responder que sim ao resumo, use step "confirmed", preencha order de novo e escreva no text só uma frase curta de agradecimento, sem repetir "pedido confirmado" (o comprovante já diz isso). O servidor gera o comprovante com o número do pedido; não invente número.
Em todas as outras respostas, use step "chat".
Faça uma etapa por mensagem quando precisar de resposta do cliente. Não pule a confirmação do passo 6.

IMPORTANTE: o envio do pedido é uma SIMULAÇÃO. Você não tem a ferramenta submitOrder e nunca deve tentar enviar o pedido ao iFood. Nada é cobrado. O passo 7 (step "confirmed") substitui o envio real.
Se o cliente perguntar sobre o pedido depois da confirmação, responda como acompanhamento simulado (por exemplo "O restaurante está preparando seu pedido"), deixando claro que é uma demonstração. Não use getOrder nem trackOrder para o pedido simulado.
Se uma ferramenta de carrinho retornar erro (restaurante fechado, item indisponível, pedido mínimo), explique o problema ao cliente e sugira uma alternativa.

Formato da resposta (saída estruturada):
- Se encontrou produtos: type "products" com exatamente 3 produtos em products, as 3 melhores opções para o pedido, da melhor para a terceira melhor. Se a busca trouxer menos de 3 que combinem, envie só esses.
- O text é uma frase curta de introdução. O chat já numera os produtos como "Escolha 1", "Escolha 2" e "Escolha 3" e mostra foto, preço e entrega, então não repita esses detalhes nem numere no text.
- Para saudações, dúvidas ou quando faltar informação: type "text" com a resposta ou uma pergunta objetiva.
- Escreva como no WhatsApp: sem Markdown (nada de ** ou #). Para listas, use uma opção por linha, com número ou emoji.
- Valores em centavos inteiros: R$ 29,90 vira 2990. Avaliação de 0 a 5.
- Use ids, nomes, fotos e valores exatamente como vieram do iFood. Nunca invente dados; omita os campos que não vierem.
- imageUrl e url só podem ser URLs http(s) retornadas pelo iFood.

Se o cliente responder com o número de uma escolha ("quero a 2", "escolha 1"), considere o produto daquela posição na sua última recomendação e comece o fluxo de pedido.
Se o cliente enviar uma imagem, o caminho do arquivo vem na mensagem. Leia-o com a ferramenta Read para entender o prato e buscar algo parecido.`;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) reject(new HttpError(413, 'A mensagem é grande demais.'));
      else chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Envie um JSON válido.')); }
    });
    request.on('error', reject);
  });
}

/** Texto enviado ao Claude. Imagens viram o caminho local para a ferramenta Read. */
function describeMessage(message, directory) {
  if (message.type === 'image' && message.image?.relativePath) {
    const path = resolve(directory, message.image.relativePath);
    return `[O cliente enviou uma imagem: ${path}]${message.content ? `\nLegenda: ${message.content}` : ''}`;
  }
  return message.content || '';
}

/** Na primeira mensagem da sessão, inclui o histórico para não perder contexto após reiniciar o servidor. */
function buildPrompt(message, history, resumed, directory) {
  const current = describeMessage(message, directory);
  if (resumed) return current;
  const previous = history.filter(item => item.id !== message.id).slice(-10)
    .map(item => `${item.role === 'user' ? 'Cliente' : 'Decide Aí'}: ${item.type === 'products'
      ? `${item.content}\n${(item.products ?? []).map((product, index) => `  Escolha ${index + 1}: ${product.name} (${product.restaurant.name}, id ${product.id}, restaurante ${product.restaurant.id ?? '?'})`).join('\n')}`
      : describeMessage(item, directory)}`);
  return previous.length ? `Conversa até agora:\n${previous.join('\n')}\n\nNova mensagem do cliente:\n${current}` : current;
}

/**
 * Lê o stream do CLI evento a evento. Se o modelo tentar qualquer ferramenta fora da lista de leitura,
 * o processo é encerrado na hora e a resposta é recusada.
 */
function runClaude({ command, args, prompt, cwd, onToolUse = () => {} }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, MCP_CONNECTION_NONBLOCKING: 'false' }, windowsHide: true });
    const toolCalls = [];
    let buffer = '';
    let stderr = '';
    let result;
    let blocked;
    const timer = setTimeout(() => { child.kill(); reject(new HttpError(504, 'O agente demorou demais para responder.')); }, TIMEOUT_MS);
    const handleLine = line => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'result') result = event;
      if (event.type !== 'assistant' || !Array.isArray(event.message?.content)) return;
      for (const block of event.message.content) {
        if (block.type !== 'tool_use') continue;
        toolCalls.push(block.name);
        if (!isAllowedTool(block.name) && !blocked) {
          blocked = block.name;
          child.kill();
        }
        if (!blocked) onToolUse(block.name);
      }
    };
    child.stdout.on('data', chunk => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach(handleLine);
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(new HttpError(500, `Não foi possível iniciar o Claude: ${error.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      handleLine(buffer);
      if (blocked) return reject(new HttpError(403, `O agente tentou usar ${blocked}, que está bloqueada. Nenhuma ação foi feita.`));
      if (!result) return reject(new HttpError(502, `O Claude terminou sem resultado (código ${code}). ${stderr.slice(-500)}`));
      resolveRun({ ...result, toolCalls });
    });
    child.stdin.end(prompt);
  });
}

const httpUrl = value => typeof value === 'string' && /^https?:\/\//.test(value) && value.length <= 2048 ? value : undefined;
const cents = value => Number.isInteger(value) && value >= 0 ? value : undefined;
const minutes = value => Number.isInteger(value) && value >= 0 && value <= 1440 ? value : undefined;
const filled = value => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

/** Remove campos fora do contrato em vez de descartar o produto inteiro na validação do chat. */
function sanitizeProduct(product) {
  const name = filled(product?.name);
  const restaurantName = filled(product?.restaurant?.name);
  const id = filled(product?.id);
  if (!name || !restaurantName || !id) return null;
  const rating = product.restaurant.rating;
  const delivery = product.delivery && compact({
    feeCents: cents(product.delivery.feeCents), minMinutes: minutes(product.delivery.minMinutes), maxMinutes: minutes(product.delivery.maxMinutes),
  });
  if (delivery?.minMinutes !== undefined && delivery.maxMinutes !== undefined && delivery.minMinutes > delivery.maxMinutes) delete delivery.minMinutes;
  return compact({
    id: id.slice(0, 128), name: name.slice(0, 160), description: filled(product.description)?.slice(0, 1000),
    imageUrl: httpUrl(product.imageUrl), priceCents: cents(product.priceCents), originalPriceCents: cents(product.originalPriceCents), url: httpUrl(product.url),
    restaurant: compact({
      id: filled(product.restaurant.id)?.slice(0, 128), name: restaurantName.slice(0, 160),
      rating: typeof rating === 'number' && rating >= 0 && rating <= 5 ? rating : undefined, ratingCount: cents(product.restaurant.ratingCount),
    }),
    delivery: delivery && Object.keys(delivery).length ? delivery : undefined,
  });
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Comprovante do pedido simulado. Nada é enviado ao iFood: o número do pedido é gerado aqui
 * e o texto deixa claro que é uma demonstração.
 */
export function formatSimulatedOrder(order, orderNumber = `DA-${randomUUID().slice(0, 6).toUpperCase()}`) {
  const money = value => Number.isInteger(value) ? brl.format(value / 100) : undefined;
  const items = (order.items ?? []).map(item => `• ${item.quantity}x ${item.name}${filled(item.details) ? ` (${item.details.trim()})` : ''}${money(item.totalCents) ? ` — ${money(item.totalCents)}` : ''}`);
  const eta = minutes(order.minMinutes) !== undefined && minutes(order.maxMinutes) !== undefined
    ? `${order.minMinutes}–${order.maxMinutes} min` : minutes(order.maxMinutes) !== undefined ? `até ${order.maxMinutes} min` : undefined;
  const lines = [
    `✅ Pedido ${orderNumber} confirmado!`,
    '',
    `🏪 ${order.merchantName}`,
    ...items,
    '',
    ...(money(order.subtotalCents) ? [`Subtotal: ${money(order.subtotalCents)}`] : []),
    ...(Number.isInteger(order.deliveryFeeCents) ? [order.deliveryFeeCents === 0 ? 'Entrega: grátis' : `Entrega: ${money(order.deliveryFeeCents)}`] : []),
    ...(order.serviceFeeCents > 0 ? [`Taxa de serviço: ${money(order.serviceFeeCents)}`] : []),
    ...(order.discountCents > 0 ? [`Desconto: -${money(order.discountCents)}`] : []),
    `Total: ${money(order.totalCents) ?? 'a consultar'}`,
    '',
    ...(filled(order.deliveryAddress) ? [`📍 ${order.deliveryAddress.trim()}`] : []),
    ...(filled(order.deliveryMethod) || eta ? [`🛵 ${[filled(order.deliveryMethod), eta].filter(Boolean).join(' · ')}`] : []),
    ...(filled(order.paymentMethod) ? [`💳 ${order.paymentMethod.trim()}`] : []),
    '',
    '🧪 Pedido simulado para demonstração: nada foi enviado ao restaurante e nada foi cobrado.',
  ];
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

const validOrder = order => filled(order?.merchantName) && Array.isArray(order.items) && order.items.length ? order : undefined;

/**
 * Converte o resultado do CLI no contrato AgentResponse do chat.
 * pendingOrder é o carrinho guardado na revisão: garante o comprovante mesmo que o modelo não repita os dados ao confirmar.
 */
export function toAgentResponse(result, conversationId, pendingOrder) {
  const output = result.structured_output;
  const base = { conversationId, messageId: `agent-${randomUUID()}` };
  if (output?.step === 'confirmed') {
    const order = validOrder(output.order) ?? pendingOrder ?? { merchantName: 'Seu pedido', items: [] };
    const receipt = formatSimulatedOrder(order);
    const thanks = filled(output.text);
    console.info('[agent:order:simulated]', order.cartId ?? 'sem carrinho');
    return { ...base, type: 'text', text: (thanks ? `${receipt}\n\n${thanks}` : receipt).slice(0, 10000) };
  }
  const ids = new Set();
  const products = (Array.isArray(output?.products) ? output.products : []).map(sanitizeProduct)
    .filter(product => product && !ids.has(product.id) && ids.add(product.id)).slice(0, MAX_CHOICES);
  if (output?.type === 'products' && products.length) {
    return { ...base, type: 'products', text: filled(output.text)?.slice(0, 10000), products };
  }
  const text = (output?.text || result.result || '').trim();
  return { ...base, type: 'text', text: text.slice(0, 10000) || 'Não consegui responder agora. Pode tentar de novo?' };
}

/**
 * Middleware Node: recebe o payload do trigger e responde em NDJSON, uma linha por evento:
 *   {"type":"status","response":AgentResponse}  aviso enviado quando o agente começa a buscar no iFood
 *   {"type":"reply","response":AgentResponse}   resposta final
 *   {"type":"error","error":string}             falha depois que o stream já começou
 * Usa o Claude Code instalado nesta máquina, que já tem o MCP do iFood autenticado.
 */
export function createAgentHandler({
  command = process.env.CLAUDE_COMMAND || 'claude',
  model = process.env.CLAUDE_MODEL || 'haiku',
  // Opcional: localização usada quando o navegador não envia a do cliente.
  fallbackLocation = parseLocation({ latitude: process.env.USER_LATITUDE, longitude: process.env.USER_LONGITUDE }),
  directory = process.cwd(),
  run = runClaude,
} = {}) {
  const sessions = new Map();
  const queues = new Map();
  // Carrinho revisado de cada conversa, aguardando o "sim" do cliente.
  const pendingOrders = new Map();

  async function answer({ conversationId, message, history = [], location }, onStatus) {
    const session = sessions.get(conversationId);
    const sessionId = session ?? randomUUID();
    const args = [
      '-p', '--output-format', 'stream-json', '--verbose', '--model', model,
      // dontAsk: tudo que não estiver em --allowedTools é negado sem perguntar.
      '--permission-mode', 'dontAsk',
      ...(session ? ['--resume', session] : ['--session-id', sessionId]),
      '--tools', 'Read', 'WebFetch',
      '--allowedTools', ...IFOOD_TOOLS, `Read(${resolve(directory, 'temp').replaceAll('\\', '/')}/**)`, `WebFetch(domain:${GEOCODER})`,
      '--disallowedTools', ...BLOCKED_TOOLS,
      '--append-system-prompt', systemPrompt(parseLocation(location) ?? fallbackLocation),
      '--json-schema', JSON.stringify(OUTPUT_SCHEMA),
    ];
    const announced = new Set();
    const onToolUse = name => {
      const step = STATUS_STEPS.find(item => item.tools.includes(name));
      if (!step || announced.has(step)) return;
      announced.add(step);
      onStatus({ conversationId, messageId: `agent-${randomUUID()}`, type: 'text', text: step.text });
    };
    const result = await run({ command, args, prompt: buildPrompt(message, history, Boolean(session), directory), cwd: directory, onToolUse });
    const forbidden = (result.toolCalls ?? []).filter(name => !isAllowedTool(name));
    if (forbidden.length) throw new HttpError(403, `O agente tentou usar ${forbidden.join(', ')}, que está bloqueada.`);
    if (result.is_error) throw new HttpError(502, result.result || 'O agente retornou um erro.');
    sessions.set(conversationId, result.session_id || sessionId);
    console.info('[agent:reply]', `${result.duration_ms} ms`, `${result.num_turns} turnos`, `US$ ${result.total_cost_usd?.toFixed(4)}`, result.toolCalls ?? []);
    const step = result.structured_output?.step;
    if (step === 'review' && validOrder(result.structured_output.order)) pendingOrders.set(conversationId, result.structured_output.order);
    const reply = toAgentResponse(result, conversationId, pendingOrders.get(conversationId));
    if (step === 'confirmed') pendingOrders.delete(conversationId);
    return reply;
  }

  return async (request, response) => {
    try {
      if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); throw new HttpError(405, 'Use POST.'); }
      const payload = await readJson(request);
      if (typeof payload?.conversationId !== 'string' || typeof payload?.message?.content !== 'string') {
        throw new HttpError(400, 'Envie conversationId e message.');
      }
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
      const send = event => { if (!response.destroyed && !response.writableEnded) response.write(`${JSON.stringify(event)}\n`); };
      // Uma resposta por vez em cada conversa, para a sessão do Claude não ser retomada em paralelo.
      const previous = queues.get(payload.conversationId) ?? Promise.resolve();
      const current = previous.catch(() => {}).then(() => answer(payload, status => send({ type: 'status', response: status })));
      queues.set(payload.conversationId, current);
      try {
        send({ type: 'reply', response: await current });
      } catch (error) {
        console.error('[agent:error]', error.message);
        send({ type: 'error', error: error.message || 'Falha no agente.' });
      }
      response.end();
    } catch (error) {
      console.error('[agent:error]', error.message);
      json(response, error.status || 500, { error: error.message || 'Falha no agente.' });
    }
  };
}
