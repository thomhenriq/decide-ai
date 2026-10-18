import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createTranscriptionHandler, MAX_AUDIO_BYTES } from '../server/transcription.mjs';
import { createLocalTranscriber } from '../server/local-transcriber.mjs';

async function invoke({ method = 'POST', headers = {}, body = Buffer.from('audio'), transcribe = async () => 'Quero uma pizza' } = {}) {
  const request = new PassThrough();
  request.method = method;
  request.headers = { host: 'localhost:5173', 'content-type': 'audio/webm;codecs=opus', ...headers };
  const response = new EventEmitter();
  response.destroyed = false;
  response.writableEnded = false;
  response.headers = {};
  response.setHeader = (key, value) => { response.headers[key] = value; };
  response.writeHead = (status, values) => { response.status = status; Object.assign(response.headers, values); };
  response.end = value => { response.body = JSON.parse(value); response.writableEnded = true; };
  request.end(body);
  await createTranscriptionHandler({ transcribe })(request, response);
  return response;
}

test('envia o áudio bruto ao transcritor local e devolve o texto', async () => {
  let calls = 0;
  const result = await invoke({ transcribe: async (audio, options) => {
    calls++;
    assert.equal(audio.toString(), 'audio');
    assert.equal(options.mimeType, 'audio/webm');
    assert.ok(options.signal instanceof AbortSignal);
    return '  Quero uma pizza de queijo  ';
  } });
  assert.equal(calls, 1);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { text: 'Quero uma pizza de queijo' });
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('rejeita origem externa, formato errado, arquivo vazio e método errado', async () => {
  const transcribe = async () => { assert.fail('Não deve chamar o modelo para uma requisição inválida.'); };
  assert.equal((await invoke({ method: 'GET', transcribe })).status, 405);
  assert.equal((await invoke({ headers: { origin: 'https://outro-site.example' }, transcribe })).status, 403);
  assert.equal((await invoke({ headers: { 'content-type': 'text/plain' }, transcribe })).status, 415);
  assert.equal((await invoke({ body: Buffer.alloc(0), transcribe })).status, 400);
  assert.equal((await invoke({ headers: { origin: 'http://localhost:5173' } })).status, 200);
});

test('limita uploads com e sem Content-Length', async () => {
  const transcribe = async () => { assert.fail('Um áudio grande não deve chegar ao modelo.'); };
  assert.equal((await invoke({ headers: { 'content-length': String(MAX_AUDIO_BYTES + 1) }, transcribe })).status, 413);
  assert.equal((await invoke({ body: Buffer.alloc(MAX_AUDIO_BYTES + 1), transcribe })).status, 413);
});

test('trata silêncio, falha de instalação e timeout sem inventar transcrição', async () => {
  assert.equal((await invoke({ transcribe: async () => ' ' })).status, 422);
  const missing = await invoke({ transcribe: async () => { throw Object.assign(new Error('Instale o modelo local.'), { status: 503 }); } });
  assert.equal(missing.status, 503);
  assert.equal(missing.body.error, 'Instale o modelo local.');
  assert.equal((await invoke({ transcribe: async () => { throw new DOMException('timeout', 'TimeoutError'); } })).status, 504);
  const failure = await invoke({ transcribe: async () => { throw new Error('internal private details'); } });
  assert.equal(failure.status, 502);
  assert.ok(!failure.body.error.includes('internal private details'));
});

test('instalação ausente informa como habilitar a transcrição local', async () => {
  const transcribe = createLocalTranscriber({ root: new URL('./fixtures/not-installed/', import.meta.url).pathname });
  await assert.rejects(transcribe(Buffer.from('audio'), { signal: new AbortController().signal }), error => error.status === 503 && error.message.includes('setup:audio'));
});
