import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccessGuard } from '../server/access.mjs';

function invoke(guard, { url = '/', host = 'demo.trycloudflare.com', headers = {} } = {}) {
  const request = { url, headers: { host, 'cf-connecting-ip': '203.0.113.7', ...headers } };
  const response = { writeHead(status, values) { this.status = status; this.headers = values; }, end(body) { this.body = body; } };
  let passed = false;
  guard(request, response, () => { passed = true; });
  return { passed, response };
}

const guard = createAccessGuard({ accessKey: 'segredo-123' });

test('sem senha configurada, libera tudo', () => {
  assert.equal(invoke(createAccessGuard(), {}).passed, true);
});

test('localhost continua livre, mas o túnel não', () => {
  for (const host of ['localhost:5173', '127.0.0.1:5173']) {
    let passed = false;
    guard({ url: '/', headers: { host } }, {}, () => { passed = true; });
    assert.equal(passed, true, host);
  }
  // Pelo túnel, o cloudflared se conecta no localhost mas envia cf-connecting-ip.
  assert.equal(invoke(guard, { host: 'localhost:5173' }).passed, false);
});

test('visitante sem senha vê a tela de login e a API responde 401', () => {
  const page = invoke(guard);
  assert.equal(page.passed, false);
  assert.equal(page.response.status, 401);
  assert.match(page.response.body, /Digite a senha/);
  const api = invoke(guard, { url: '/api/agent' });
  assert.equal(api.response.status, 401);
  assert.match(api.response.body, /não autorizado/);
});

test('senha correta grava cookie e remove a senha da URL', () => {
  const { response } = invoke(guard, { url: '/?preview=products&key=segredo-123' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.Location, '/?preview=products');
  assert.match(response.headers['Set-Cookie'], /^decide_ai_access=segredo-123; .*HttpOnly; Secure/);
  assert.equal(invoke(guard, { url: '/api/agent', headers: { cookie: 'outro=1; decide_ai_access=segredo-123' } }).passed, true);
});

test('senha ou cookie errados são recusados', () => {
  const wrong = invoke(guard, { url: '/?key=chute' });
  assert.equal(wrong.response.status, 401);
  assert.match(wrong.response.body, /Senha incorreta/);
  assert.equal(invoke(guard, { headers: { cookie: 'decide_ai_access=chute' } }).passed, false);
});
