import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createAgentHandler, SEARCHING_TEXT, toAgentResponse } from '../server/agent.mjs';

async function invoke(handler, payload) {
  const request = new PassThrough();
  request.method = 'POST';
  request.headers = {};
  let raw = '';
  const response = {
    destroyed: false, writableEnded: false, setHeader() {},
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    write(chunk) { raw += chunk; },
    end(chunk = '') { raw += chunk; this.writableEnded = true; },
  };
  request.end(JSON.stringify(payload));
  await handler(request, response);
  // Erros de validação respondem JSON comum; o resto vem em NDJSON.
  if (response.headers['Content-Type'].startsWith('application/json')) response.body = JSON.parse(raw);
  else response.events = raw.trim().split('\n').map(line => JSON.parse(line));
  return response;
}

const message = (id, content) => ({ id, role: 'user', content, createdAt: '2026-10-18T12:00:00.000Z', type: 'text' });

test('converte produtos e remove campos fora do contrato', () => {
  const reply = toAgentResponse({ structured_output: { type: 'products', text: 'Achei:', products: [
    { id: 'a', name: 'Pizza', imageUrl: 'javascript:alert(1)', priceCents: 2990, restaurant: { name: 'Casa', rating: 7 }, delivery: { minMinutes: 50, maxMinutes: 30 } },
    { id: 'a', name: 'Duplicada', restaurant: { name: 'Casa' } },
    { id: 'b', name: '', restaurant: { name: 'Sem nome' } },
  ] } }, 'conv');
  assert.equal(reply.type, 'products');
  assert.equal(reply.conversationId, 'conv');
  assert.deepEqual(reply.products, [{ id: 'a', name: 'Pizza', priceCents: 2990, restaurant: { name: 'Casa' }, delivery: { maxMinutes: 30 } }]);
});

test('usa o texto livre quando não há saída estruturada', () => {
  const reply = toAgentResponse({ result: '  Oi! O que vai ser hoje?  ' }, 'conv');
  assert.deepEqual({ type: reply.type, text: reply.text }, { type: 'text', text: 'Oi! O que vai ser hoje?' });
});

test('mantém a sessão do Claude por conversa e nunca libera o envio do pedido', async () => {
  const calls = [];
  const handler = createAgentHandler({ run: async call => { calls.push(call); return { session_id: 'sessao-1', structured_output: { type: 'text', text: 'Ok' } }; } });
  const first = await invoke(handler, { conversationId: 'conv', message: message('1', 'oi'), history: [message('1', 'oi')] });
  await invoke(handler, { conversationId: 'conv', message: message('2', 'pizza'), history: [] });
  assert.equal(first.status, 200);
  assert.deepEqual(first.events.map(event => [event.type, event.response.text]), [['reply', 'Ok']]);
  assert.ok(calls[0].args.includes('--session-id'));
  assert.deepEqual(calls[1].args.slice(calls[1].args.indexOf('--resume'), calls[1].args.indexOf('--resume') + 2), ['--resume', 'sessao-1']);
  const allowed = calls[0].args.slice(calls[0].args.indexOf('--allowedTools') + 1, calls[0].args.indexOf('--disallowedTools'));
  assert.ok(!allowed.includes('mcp__iFood__submitOrder'));
  const disallowed = calls[0].args.slice(calls[0].args.indexOf('--disallowedTools') + 1, calls[0].args.indexOf('--append-system-prompt'));
  assert.deepEqual(disallowed, ['mcp__iFood__submitOrder']);
});

test('recusa payload sem mensagem', async () => {
  const handler = createAgentHandler({ run: async () => assert.fail('não deveria chamar o Claude') });
  const response = await invoke(handler, { conversationId: 'conv' });
  assert.equal(response.status, 400);
});

test('recusa a resposta se o agente chamar uma ferramenta bloqueada', async () => {
  const handler = createAgentHandler({ run: async () => ({ session_id: 's', toolCalls: ['mcp__iFood__searchOffers', 'mcp__iFood__submitOrder'], structured_output: { type: 'text', text: 'Pedido feito' } }) });
  const response = await invoke(handler, { conversationId: 'conv', message: message('1', 'finaliza'), history: [] });
  assert.deepEqual(response.events.map(event => event.type), ['error']);
  assert.match(response.events[0].error, /submitOrder/);
});

test('libera carrinho, endereço, entrega e pagamento para a simulação', async () => {
  const calls = [];
  const handler = createAgentHandler({ run: async call => { calls.push(call); return { session_id: 's', structured_output: { type: 'text', text: 'Ok' } }; } });
  await invoke(handler, { conversationId: 'conv', message: message('1', 'oi'), history: [] });
  const { args } = calls[0];
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
  const allowed = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'));
  for (const tool of ['createCart', 'addItemToCart', 'getCart', 'setCartDelivery', 'listPaymentMethods', 'setCartPayment', 'listAddresses', 'createAddress']) {
    assert.ok(allowed.includes(`mcp__iFood__${tool}`), tool);
  }
});

test('confirmação gera comprovante simulado sem chamar o envio real', async () => {
  const statuses = [];
  const handler = createAgentHandler({ run: async ({ onToolUse }) => {
    ['mcp__iFood__createCart', 'mcp__iFood__addItemToCart', 'mcp__iFood__setCartPayment', 'mcp__iFood__getCart'].forEach(onToolUse);
    return { session_id: 's', toolCalls: ['mcp__iFood__getCart'], structured_output: { type: 'text', step: 'confirmed', text: 'Obrigado!', order: {
      cartId: 'c1', merchantName: 'Pizza Hut', items: [{ name: 'Pizza Individual', quantity: 2, totalCents: 6980 }],
      subtotalCents: 6980, deliveryFeeCents: 0, totalCents: 6980, paymentMethod: 'PIX', minMinutes: 30, maxMinutes: 45,
    } } };
  } });
  const response = await invoke(handler, { conversationId: 'conv', message: message('1', 'sim, confirma'), history: [] });
  const events = response.events;
  for (const event of events) if (event.type === 'status') statuses.push(event.response.text);
  assert.deepEqual(statuses, ['Montando seu carrinho 🛒', 'Conferindo entrega e pagamento 💳']);
  const receipt = events.at(-1).response.text;
  assert.match(receipt, /^✅ Pedido DA-[0-9A-F]{6} confirmado!/);
  assert.match(receipt, /2x Pizza Individual — R\$\s69,80/);
  assert.match(receipt, /Entrega: grátis/);
  assert.match(receipt, /30–45 min/);
  assert.match(receipt, /simulado.*nada foi cobrado/);
  assert.match(receipt, /Obrigado!$/);
});

test('usa o carrinho da revisão quando o modelo confirma sem repetir os dados', async () => {
  const outputs = [
    { type: 'text', step: 'review', text: 'Resumo... Posso confirmar o pedido?', order: { cartId: 'c9', merchantName: 'Ponto Final', items: [{ name: 'Açaí', quantity: 1, totalCents: 790 }], serviceFeeCents: 99, totalCents: 889 } },
    { type: 'text', step: 'confirmed', text: 'Pedido confirmado! Obrigado.' },
  ];
  const handler = createAgentHandler({ run: async () => ({ session_id: 's', structured_output: outputs.shift() }) });
  const review = await invoke(handler, { conversationId: 'conv', message: message('1', 'pix'), history: [] });
  assert.equal(review.events.at(-1).response.text, 'Resumo... Posso confirmar o pedido?');
  const confirmed = await invoke(handler, { conversationId: 'conv', message: message('2', 'sim'), history: [] });
  const receipt = confirmed.events.at(-1).response.text;
  assert.match(receipt, /^✅ Pedido DA-/);
  assert.match(receipt, /🏪 Ponto Final\n• 1x Açaí — R\$\s7,90/);
  assert.match(receipt, /Taxa de serviço: R\$\s0,99\nTotal: R\$\s8,89/);
  assert.match(receipt, /nada foi cobrado/);
});

test('envia o aviso de busca antes da resposta, uma única vez', async () => {
  const handler = createAgentHandler({ run: async ({ onToolUse }) => {
    onToolUse('WebFetch');
    onToolUse('mcp__iFood__searchOffers');
    onToolUse('mcp__iFood__getItem');
    return { session_id: 's', structured_output: { type: 'products', text: 'Achei:', products: [1, 2, 3, 4].map(n => ({ id: `p${n}`, name: `Pizza ${n}`, restaurant: { name: 'Casa' } })) } };
  } });
  const response = await invoke(handler, { conversationId: 'conv', message: message('1', 'pizza'), history: [] });
  assert.deepEqual(response.events.map(event => event.type), ['status', 'reply']);
  assert.equal(response.events[0].response.text, SEARCHING_TEXT);
  assert.equal(response.events[0].response.conversationId, 'conv');
  assert.deepEqual(response.events[1].response.products.map(product => product.id), ['p1', 'p2', 'p3']);
});

test('não envia aviso quando o agente só pergunta algo', async () => {
  const handler = createAgentHandler({ run: async () => ({ session_id: 's', structured_output: { type: 'text', text: 'Doce ou salgado?' } }) });
  const response = await invoke(handler, { conversationId: 'conv', message: message('1', 'tô com fome'), history: [] });
  assert.deepEqual(response.events.map(event => event.type), ['reply']);
});

test('usa o GPS do navegador e, sem ele, instrui o agente a pedir o endereço', async () => {
  const prompts = [];
  const handler = createAgentHandler({ fallbackLocation: undefined, run: async ({ args }) => { prompts.push(args[args.indexOf('--append-system-prompt') + 1]); return { session_id: 's', structured_output: { type: 'text', text: 'Ok' } }; } });
  await invoke(handler, { conversationId: 'a', message: message('1', 'oi'), history: [], location: { latitude: -23.5, longitude: -46.6 } });
  await invoke(handler, { conversationId: 'b', message: message('1', 'oi'), history: [] });
  await invoke(handler, { conversationId: 'c', message: message('1', 'oi'), history: [], location: { latitude: 999, longitude: 0 } });
  assert.match(prompts[0], /latitude -23\.5, longitude -46\.6/);
  assert.match(prompts[1], /NÃO está disponível/);
  assert.match(prompts[2], /NÃO está disponível/);
});

test('registra o evento da conversa no banco, sem guardar coordenadas', async () => {
  const { createEventStore } = await import('../server/events.mjs');
  const events = createEventStore({ path: ':memory:' });
  const outputs = [
    { type: 'products', step: 'chat', text: 'Achei:', termo: 'Açaí', semOpcao: false, orcamentoMaxItem: 20, products: [{ id: 'i1', name: 'Açaí', restaurant: { id: 'm1', name: 'Ponto' } }] },
    { type: 'text', step: 'confirmed', text: 'Obrigado!', termo: 'açaí', semOpcao: false, order: { merchantName: 'Ponto', items: [{ name: 'Açaí', quantity: 1 }], totalCents: 790 } },
    { type: 'text', step: 'chat', text: 'Não achei poke aberto agora.', termo: 'poke', semOpcao: true },
  ];
  const handler = createAgentHandler({ events, geocode: async () => ({ bairro: 'Cidade Universitária', cidade: 'Campinas' }),
    run: async () => ({ session_id: 's', structured_output: outputs.shift() }) });
  const location = { latitude: -22.8184, longitude: -47.0647 };
  await invoke(handler, { conversationId: 'c1', message: message('1', 'quero açaí até 20'), history: [], location });
  await invoke(handler, { conversationId: 'c1', message: message('2', 'sim'), history: [], location });
  await invoke(handler, { conversationId: 'c2', message: message('3', 'quero poke'), history: [] });
  const linhas = events.db.prepare('SELECT termo, resultado, bairro, cidade, orcamento_max_item AS orcamento FROM eventos ORDER BY termo').all()
    .map(l => ({ ...l }));
  assert.deepEqual(linhas, [
    { termo: 'açaí', resultado: 'aceitou', bairro: 'Cidade Universitária', cidade: 'Campinas', orcamento: 20 },
    { termo: 'poke', resultado: 'sem_opcao', bairro: null, cidade: null, orcamento: null },
  ]);
  assert.equal(events.db.prepare('SELECT COUNT(*) AS n FROM exibicoes').get().n, 1);
  assert.ok(!JSON.stringify(events.db.prepare('SELECT * FROM eventos').all()).includes('-22.8'));
});
