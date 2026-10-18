import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypeScript } from './import-typescript.mjs';

const { resizeTextarea, observeTextareaWidth } = await importTypeScript('../src/components/useTextareaAutosize.ts');

test('campo iniciado em um chat oculto não recebe altura zero', () => {
  const field = { style: { height: '' }, scrollHeight: 0 };
  resizeTextarea(field);
  assert.equal(field.style.height, 'auto');
  field.scrollHeight = 22;
  resizeTextarea(field);
  assert.equal(field.style.height, '22px');
});

test('reabrir o restaurante recalcula um rascunho mesmo sem alterar seu texto', () => {
  const field = { style: { height: '' }, scrollHeight: 0, clientWidth: 0 };
  let notify;
  let disconnected = false;
  class FakeObserver {
    constructor(callback) { notify = callback; }
    observe(target) { assert.equal(target, field); }
    disconnect() { disconnected = true; }
  }
  resizeTextarea(field);
  const cleanup = observeTextareaWidth(field, FakeObserver);
  field.clientWidth = 260;
  field.scrollHeight = 44;
  notify();
  assert.equal(field.style.height, '44px');
  field.clientWidth = 0;
  field.scrollHeight = 0;
  notify();
  field.clientWidth = 260;
  field.scrollHeight = 66;
  notify();
  assert.equal(field.style.height, '66px');
  cleanup();
  assert.equal(disconnected, true);
});

test('rascunhos longos mantêm o limite de altura e voltam a uma linha quando apagados', () => {
  const field = { style: { height: '' }, scrollHeight: 300 };
  resizeTextarea(field);
  assert.equal(field.style.height, '112px');
  field.scrollHeight = 22;
  resizeTextarea(field);
  assert.equal(field.style.height, '22px');
});
