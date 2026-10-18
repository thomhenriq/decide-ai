import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importTypeScript } from './import-typescript.mjs';

const { default: App } = await importTypeScript('../src/App.tsx');
const { MessageBubble } = await importTypeScript('../src/components/MessageBubble.tsx');
const { prepareWeeklyInsight, createRestaurantDemoConversation, RESTAURANT_ID, RESTAURANT_STORAGE_KEY } = await importTypeScript('../src/services/restaurantInsights.ts');
const { newConversation, createMessage, loadConversation, saveConversation } = await importTypeScript('../src/services/storage.ts');
const example = JSON.parse(await readFile(new URL('../public/examples/weekly-insight.json', import.meta.url), 'utf8'));

function withStorage(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const memory = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
  } });
  try { run(); }
  finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
}

test('cliente começa vazio; restaurante já recebe o exemplo do Decide Aí', () => withStorage(() => {
  const html = renderToStaticMarkup(createElement(App));
  const [client, restaurant] = html.split('id="restaurant-panel-title"');
  assert.ok(client.includes('id="client-panel-title">Cliente'));
  assert.ok(restaurant.includes('>Restaurante</h2>'));
  assert.ok(client.includes('Bateu a fome?'));
  assert.ok(!client.includes('class="message message--assistant"'));
  assert.ok(restaurant.includes('aria-label="Decide Aí"'));
  assert.ok(restaurant.includes('açaí após a 1h'));
  assert.ok(restaurant.includes('00h30'));
  assert.ok(restaurant.includes('dados ilustrativos'));
  assert.ok(restaurant.includes('Mensagem do restaurante'));
}));

test('insight pode iniciar a conversa, ignora outro restaurante e evita duplicação', () => {
  const conversation = newConversation();
  const result = prepareWeeklyInsight(example, conversation, RESTAURANT_ID);
  assert.equal(result.status, 'accepted');
  assert.equal(prepareWeeklyInsight(example, conversation, 'outro-restaurante').status, 'ignored');
  const message = { ...createMessage('assistant', result.insight.text), id: result.insight.messageId };
  conversation.messages.push(message);
  assert.equal(prepareWeeklyInsight(example, conversation, RESTAURANT_ID).status, 'duplicate');
  assert.equal(prepareWeeklyInsight({ ...example, messageId: 'outra-semana' }, conversation, RESTAURANT_ID).status, 'accepted');
});

test('históricos de cliente e restaurante persistem separados e preservam conversa vazia', () => withStorage(() => {
  const client = { ...newConversation(), messages: [createMessage('user', 'Quero jantar')] };
  const restaurant = createRestaurantDemoConversation();
  restaurant.messages.push(createMessage('user', 'Vou testar o novo horário.'));
  saveConversation(client);
  saveConversation(restaurant, RESTAURANT_STORAGE_KEY);
  assert.deepEqual(loadConversation(), client);
  assert.deepEqual(loadConversation(RESTAURANT_STORAGE_KEY, createRestaurantDemoConversation), restaurant);
  saveConversation(newConversation());
  assert.equal(loadConversation().messages.length, 0);
  assert.equal(loadConversation(RESTAURANT_STORAGE_KEY).messages.length, 2);
  const empty = newConversation();
  saveConversation(empty, RESTAURANT_STORAGE_KEY);
  assert.deepEqual(loadConversation(RESTAURANT_STORAGE_KEY, createRestaurantDemoConversation), empty);
}));

test('rejeita resumo inválido e exibe conteúdo recebido apenas como texto', () => {
  for (const invalid of [null, 'resumo', { ...example, type: 'products' }, { ...example, restaurantId: '' }, { ...example, messageId: ' ' }, { ...example, text: '' }, { ...example, text: 'a'.repeat(10001) }]) {
    assert.throws(() => prepareWeeklyInsight(invalid, newConversation(), RESTAURANT_ID));
  }
  const malicious = { ...example, text: '<script>alert(1)</script>' };
  const result = prepareWeeklyInsight(malicious, newConversation(), RESTAURANT_ID);
  const html = renderToStaticMarkup(createElement(MessageBubble, { message: createMessage('assistant', result.insight.text), onRetryAudio: () => {}, assistantLabel: 'Decide Aí' }));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
});
