import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rmdir, unlink, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { importTypeScript } from './import-typescript.mjs';
import { createImageHandlers, MAX_IMAGE_BYTES } from '../server/images.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL9kAAAAASUVORK5CYII=', 'base64');

async function invoke(handler, { method = 'POST', url = '/api/images', headers = {}, body = PNG } = {}) {
  const request = new PassThrough();
  request.method = method;
  request.url = url;
  request.headers = { host: 'localhost:5173', 'content-type': 'image/png', 'x-file-name': encodeURIComponent('prato de comida.png'), ...headers };
  const response = new EventEmitter();
  response.destroyed = false;
  response.writableEnded = false;
  response.headers = {};
  response.setHeader = (key, value) => { response.headers[key] = value; };
  response.writeHead = (status, values) => { response.status = status; Object.assign(response.headers, values); };
  response.end = value => { response.body = value; response.writableEnded = true; };
  request.end(body);
  await handler(request, response);
  return response;
}

async function withImages(run) {
  await mkdir('.sites-runtime', { recursive: true });
  const directory = await mkdtemp(resolve('.sites-runtime/image-tests-'));
  try { await run(createImageHandlers({ directory }), directory); }
  finally {
    for (const name of await readdir(directory)) await unlink(resolve(directory, name));
    await rmdir(directory);
  }
}

test('salva imagem com nome único, mantém os bytes e permite reabrir por GET e HEAD', async () => {
  await withImages(async (handlers, directory) => {
    const upload = await invoke(handlers.upload);
    assert.equal(upload.status, 201);
    const image = JSON.parse(upload.body);
    assert.match(image.relativePath, /^temp\/[0-9a-f-]{36}\.png$/);
    assert.equal(image.originalName, 'prato de comida.png');
    assert.equal(image.mimeType, 'image/png');
    assert.equal(image.size, PNG.length);
    assert.deepEqual(await readFile(resolve(directory, `${image.id}.png`)), PNG);
    const served = await invoke(handlers.serve, { method: 'GET', url: image.url });
    assert.equal(served.status, 200);
    assert.deepEqual(served.body, PNG);
    assert.equal(served.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(served.headers['Content-Type'], 'image/png');
    const head = await invoke(handlers.serve, { method: 'HEAD', url: image.url });
    assert.equal(head.status, 200);
    assert.equal(head.body, undefined);
    const second = JSON.parse((await invoke(handlers.upload)).body);
    assert.notEqual(second.id, image.id);
  });
});

test('rejeita arquivos grandes, MIME não permitido, conteúdo falso e origem externa', async () => {
  await withImages(async (handlers, directory) => {
    assert.equal((await invoke(handlers.upload, { method: 'GET' })).status, 405);
    assert.equal((await invoke(handlers.upload, { headers: { origin: 'https://outro.example' } })).status, 403);
    assert.equal((await invoke(handlers.upload, { headers: { 'content-type': 'image/svg+xml' } })).status, 415);
    assert.equal((await invoke(handlers.upload, { body: Buffer.from('texto disfarçado de imagem') })).status, 415);
    assert.equal((await invoke(handlers.upload, { body: Buffer.alloc(0) })).status, 400);
    assert.equal((await invoke(handlers.upload, { headers: { 'content-length': String(MAX_IMAGE_BYTES + 1) } })).status, 413);
    assert.equal((await invoke(handlers.upload, { body: Buffer.alloc(MAX_IMAGE_BYTES + 1) })).status, 413);
    assert.deepEqual(await readdir(directory), []);
  });
});

test('não usa o nome enviado para escolher o caminho e não permite ler outros arquivos', async () => {
  await withImages(async (handlers, directory) => {
    const image = JSON.parse((await invoke(handlers.upload, { headers: { 'x-file-name': encodeURIComponent('../../foto.png') } })).body);
    assert.equal(image.originalName, 'foto.png');
    assert.deepEqual(await readdir(directory), [`${image.id}.png`]);
    for (const url of ['/api/images/../../package.json', '/api/images/%2e%2e%2fpackage.json', '/api/images/.gitkeep', '/api/images/qualquer.png']) {
      assert.equal((await invoke(handlers.serve, { method: 'GET', url })).status, 404);
    }
  });
});

test('apaga cada imagem da pasta depois de 10 mensagens novas, inclusive as que já estavam lá', async () => {
  await withImages(async (_, directory) => {
    await writeFile(resolve(directory, '1bb09048-3041-44fa-afaa-d169c65f2db0.png'), PNG);
    await writeFile(resolve(directory, '.gitkeep'), '');
    const handlers = createImageHandlers({ directory });
    for (let i = 0; i < 3; i++) await handlers.messageSent();
    const image = JSON.parse((await invoke(handlers.upload)).body);
    for (let i = 0; i < 7; i++) await handlers.messageSent();
    assert.deepEqual((await readdir(directory)).sort(), ['.gitkeep', `${image.id}.png`]);
    for (let i = 0; i < 2; i++) await handlers.messageSent();
    assert.deepEqual((await readdir(directory)).sort(), ['.gitkeep', `${image.id}.png`]);
    await handlers.messageSent();
    assert.deepEqual(await readdir(directory), ['.gitkeep']);
    assert.equal((await invoke(handlers.serve, { method: 'GET', url: image.url })).status, 404);
  });
});

test('frontend envia imagem e recebe caminho sem precisar de uma API externa', async () => {
  const { uploadImage, validateImage } = await importTypeScript('../src/services/images.ts');
  const file = new File([PNG], 'comida.png', { type: 'image/png' });
  assert.doesNotThrow(() => validateImage(file));
  assert.throws(() => validateImage(new File(['audio'], 'nota.webm', { type: 'audio/webm' })), /JPG/);
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/images');
      assert.equal(options.method, 'POST');
      assert.equal(options.body, file);
      return Response.json({ id: '1bb09048-3041-44fa-afaa-d169c65f2db0', mimeType: 'image/png', originalName: 'comida.png', size: file.size,
        url: '/api/images/1bb09048-3041-44fa-afaa-d169c65f2db0.png', relativePath: 'temp/1bb09048-3041-44fa-afaa-d169c65f2db0.png' }, { status: 201 });
    };
    assert.match((await uploadImage(file)).relativePath, /^temp\//);
    globalThis.fetch = async () => Response.json({ error: 'Disco indisponível' }, { status: 500 });
    await assert.rejects(uploadImage(file), /Disco indisponível/);
  } finally { globalThis.fetch = previous; }
});

test('histórico preserva imagem, legenda e mensagens anteriores ao recarregar', async () => {
  const { loadConversation, saveConversation, createMessage } = await importTypeScript('../src/services/storage.ts');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const memory = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) } });
  try {
    const image = { id: '1bb09048-3041-44fa-afaa-d169c65f2db0', mimeType: 'image/png', size: PNG.length, originalName: 'comida.png', url: '/api/images/1bb09048-3041-44fa-afaa-d169c65f2db0.png', relativePath: 'temp/1bb09048-3041-44fa-afaa-d169c65f2db0.png' };
    const conversation = { id: 'conversation', messages: [createMessage('user', 'Oi'), { ...createMessage('user', 'Quero algo assim'), type: 'image', image }] };
    saveConversation(conversation);
    assert.deepEqual(loadConversation(), conversation);
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
});
