import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importTypeScript } from './import-typescript.mjs';

const { normalizeAgentResponse, isSafeProductUrl, prepareAgentDelivery } = await importTypeScript('../src/services/agentMessages.ts');
const { ProductRecommendations } = await importTypeScript('../src/components/ProductRecommendations.tsx');
const { formatProductCaption, splitMessageText } = await importTypeScript('../src/services/whatsappFormatting.ts');
const { loadConversation, saveConversation, createMessage } = await importTypeScript('../src/services/storage.ts');
const example = JSON.parse(await readFile(new URL('../public/examples/products.json', import.meta.url), 'utf8'));

test('contratos de texto, produto único e múltiplos produtos são aceitos', async () => {
  assert.deepEqual(normalizeAgentResponse(' Olá! '), { type: 'text', text: 'Olá!' });
  assert.equal(normalizeAgentResponse('   '), null);
  for (const file of ['text', 'product', 'products']) {
    const input = JSON.parse(await readFile(new URL(`../public/examples/${file}.json`, import.meta.url), 'utf8'));
    assert.equal(normalizeAgentResponse(input).type, input.type);
  }
  const result = normalizeAgentResponse({ ...example, conversationId: 'conversa-1', messageId: 'resposta-1' });
  assert.equal(result.products.length, 3);
  assert.equal(result.conversationId, 'conversa-1');
  assert.equal(result.messageId, 'resposta-1');
});

test('rejeita preço inválido, avaliação fora da escala, prazo invertido e IDs duplicados', () => {
  const make = () => structuredClone(example);
  let input = make(); input.products[0].priceCents = 29.9;
  assert.throws(() => normalizeAgentResponse(input), /centavos/);
  input = make(); input.products[0].priceCents = -1;
  assert.throws(() => normalizeAgentResponse(input));
  input = make(); input.products[0].restaurant.rating = 6;
  assert.throws(() => normalizeAgentResponse(input));
  input = make(); input.products[0].delivery.minMinutes = 90;
  assert.throws(() => normalizeAgentResponse(input));
  input = make(); input.products[1].id = ` ${input.products[0].id} `;
  assert.throws(() => normalizeAgentResponse(input), /IDs diferentes/);
  assert.throws(() => normalizeAgentResponse({ type: 'products', products: [] }));
});

test('URLs de produto e foto não aceitam scripts, credenciais ou conteúdo embutido', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,teste', 'file:///segredo', '//outro.example/foto', 'https://user:password@example.com/foto']) assert.equal(isSafeProductUrl(url), false);
  for (const url of ['/examples/burger.svg', 'https://example.com/foto.jpg']) assert.equal(isSafeProductUrl(url), true);
  const input = structuredClone(example);
  input.products[0].url = 'javascript:alert(1)';
  assert.throws(() => normalizeAgentResponse(input));
});

test('normalização mantém snapshot e não modifica o objeto do agente', () => {
  const input = structuredClone(example);
  const result = normalizeAgentResponse(input);
  input.products[0].restaurant.name = 'Alterado depois';
  input.products[0].delivery.feeCents = 9999;
  assert.equal(result.products[0].restaurant.name, 'Quintal Burger');
  assert.equal(result.products[0].delivery.feeCents, 0);
});

test('produtos aparecem como mensagens de foto e legenda, sem carrossel ou botões personalizados', () => {
  const result = normalizeAgentResponse(example);
  const createdAt = '2026-10-17T12:00:00.000Z';
  const html = renderToStaticMarkup(createElement(ProductRecommendations, { products: result.products, text: result.text, createdAt }));
  for (const text of ['Burger da casa', 'Quintal Burger', '4,8', '29,90', 'Entrega grátis', '25–40 min', '/examples/burger.svg']) assert.ok(html.includes(text), `Conteúdo ausente: ${text}`);
  assert.equal((html.match(/class="message message--assistant message--product-photo"/g) || []).length, 3);
  assert.ok(!html.includes('product-carousel'));
  assert.ok(!html.includes('<button'));
  const minimal = normalizeAgentResponse({ type: 'products', products: [{ id: '1', name: '<script>produto</script>', restaurant: { name: 'Restaurante' } }] });
  const missing = renderToStaticMarkup(createElement(ProductRecommendations, { products: minimal.products, text: '', createdAt }));
  for (const text of ['Foto não disponível', 'Preço não informado', 'Nota não informada', 'Frete a consultar', 'Prazo a consultar', '&lt;script&gt;']) assert.ok(missing.includes(text));
  assert.ok(!missing.includes('<script>'));
});

test('legendas ficam curtas, textos longos são separados e links usam mensagem de texto', () => {
  const product = { ...example.products[0], description: 'Descrição longa '.repeat(60), url: 'https://example.com/produto' };
  const caption = formatProductCaption(product);
  assert.ok(caption.length <= 900);
  assert.ok(caption.includes('Preço:'));
  assert.ok(!caption.includes(product.url));
  const html = renderToStaticMarkup(createElement(ProductRecommendations, { products: [product], text: '', createdAt: '2026-10-17T12:00:00.000Z' }));
  assert.ok(html.includes('href="https://example.com/produto"'));
  assert.ok(!html.includes('Ver opção'));
  const parts = splitMessageText('🍔'.repeat(4500));
  assert.ok(parts.length > 1 && parts.every(part => part.length <= 4000));
  assert.equal(parts.join(''), '🍔'.repeat(4500));
});

test('recebimento exige início pelo usuário, ignora outra conversa e evita reenvios duplicados', () => {
  const response = { ...example, conversationId: 'conversa-1', messageId: 'resposta-1' };
  assert.equal(prepareAgentDelivery(response, { id: 'conversa-1', messages: [] }).status, 'ignored');
  const conversation = { id: 'conversa-1', messages: [createMessage('user', 'Quero jantar')] };
  assert.equal(prepareAgentDelivery(response, conversation).status, 'accepted');
  assert.equal(prepareAgentDelivery({ ...response, conversationId: 'conversa-antiga' }, conversation).status, 'ignored');
  conversation.messages.push({ ...createMessage('assistant', 'Resposta anterior'), id: 'resposta-1' });
  assert.equal(prepareAgentDelivery(response, conversation).status, 'duplicate');
});

test('produtos recebidos persistem sem apagar texto, imagens ou áudios existentes', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const memory = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) } });
  try {
    const response = normalizeAgentResponse(example);
    const image = { ...createMessage('user', 'Quero algo assim'), type: 'image', image: { id: '1bb09048-3041-44fa-afaa-d169c65f2db0', mimeType: 'image/png', size: 100, originalName: 'foto.png', url: '/api/images/1bb09048-3041-44fa-afaa-d169c65f2db0.png', relativePath: 'temp/1bb09048-3041-44fa-afaa-d169c65f2db0.png' } };
    const audio = { ...createMessage('user', 'Uma opção até trinta reais'), type: 'audio', audio: { id: 'audio-1', mimeType: 'audio/webm', transcriptionStatus: 'completed' } };
    const conversation = { id: 'conversa-1', messages: [createMessage('user', 'Quero jantar'), image, audio, { ...createMessage('assistant', response.text), type: 'products', products: response.products }] };
    saveConversation(conversation);
    assert.deepEqual(loadConversation(), JSON.parse(JSON.stringify(conversation)));
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
});

test('numera a legenda como Escolha N quando informado', () => {
  const product = { id: 'p', name: 'Pizza', restaurant: { name: 'Casa' } };
  assert.ok(formatProductCaption(product, 2).startsWith('Escolha 2\nPizza\n'));
  assert.ok(formatProductCaption(product).startsWith('Pizza\n'));
});
