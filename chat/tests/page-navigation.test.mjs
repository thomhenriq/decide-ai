import assert from 'node:assert/strict';
import test from 'node:test';
import { importTypeScript } from './import-typescript.mjs';

const { pageAfterGesture, canScrollChat, createWheelPager } = await importTypeScript('../src/services/pageNavigation.ts');

test('gestos curtos e horizontais mantêm a página; gestos verticais longos trocam sem circular', () => {
  assert.equal(pageAfterGesture(0, 0, 95), 0);
  assert.equal(pageAfterGesture(0, 0, 96), 1);
  assert.equal(pageAfterGesture(1, 0, -96), 0);
  assert.equal(pageAfterGesture(1, 0, -60), 1);
  assert.equal(pageAfterGesture(0, 130, 100), 0);
  assert.equal(pageAfterGesture(1, 130, -100), 1);
  assert.equal(pageAfterGesture(0, 0, -300), 0);
  assert.equal(pageAfterGesture(1, 0, 300), 1);
});

test('a rolagem do histórico tem prioridade até atingir seus limites', () => {
  const top = { scrollTop: 0, scrollHeight: 1400, clientHeight: 400 };
  assert.equal(canScrollChat(top, 100), true);
  assert.equal(canScrollChat(top, -100), false);
  const bottom = { ...top, scrollTop: 1000 };
  assert.equal(canScrollChat(bottom, 100), false);
  assert.equal(canScrollChat(bottom, -100), true);
  const middle = { ...top, scrollTop: 500 };
  assert.equal(canScrollChat(middle, 100), true);
  assert.equal(canScrollChat(middle, -100), true);
  assert.equal(canScrollChat({ ...top, scrollHeight: 400 }, 100), false);
  assert.equal(canScrollChat(null, 100), false);
});

test('roda e trackpad acumulam movimento e ignoram a inércia após uma troca', () => {
  const pager = createWheelPager();
  assert.deepEqual(pager.move(0, 40, false, 0), { page: 0, consume: true });
  assert.equal(pager.move(0, 40, false, 30).page, 0);
  assert.equal(pager.move(0, 40, false, 60).page, 1);
  // Mesmo que o outro chat tenha histórico rolável, a inércia não o arrasta.
  assert.deepEqual(pager.move(1, -200, true, 90), { page: 1, consume: true });
  assert.deepEqual(pager.move(1, -120, false, 400), { page: 0, consume: true });
});

test('chegar ao fim do histórico não troca a página na mesma rajada de rolagem', () => {
  const pager = createWheelPager();
  assert.deepEqual(pager.move(0, 100, true, 0), { page: 0, consume: false });
  assert.deepEqual(pager.move(0, 200, false, 70), { page: 0, consume: false });
  assert.deepEqual(pager.move(0, 120, false, 400), { page: 1, consume: true });
  pager.reset();
  assert.equal(pager.move(0, 70, false, 440).page, 0);
});
