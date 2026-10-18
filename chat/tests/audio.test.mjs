import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function importTypeScript(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { prepareAudio, formatDuration, transcribeAudio, MAX_AUDIO_BYTES } = await importTypeScript('../src/services/audio.ts');
const { createMessage, loadConversation, saveConversation } = await importTypeScript('../src/services/storage.ts');

test('aceita áudio gravado e arquivo sem MIME, rejeita arquivo inválido', () => {
  assert.equal(prepareAudio(new Blob(['bytes'], { type: 'audio/webm;codecs=opus' })).type, 'audio/webm');
  assert.equal(prepareAudio(new Blob(['bytes']), 'nota.m4a').type, 'audio/mp4');
  assert.throws(() => prepareAudio(new Blob([]), 'nota.mp3'), /vazio/);
  assert.throws(() => prepareAudio(new Blob(['bytes'], { type: 'text/plain' }), 'nota.mp3'), /Use um áudio/);
  assert.throws(() => prepareAudio(new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: 'audio/wav' })), /20 MB/);
  assert.equal(formatDuration(65.7), '1:05');
});

test('chama o backend local e propaga a mensagem de erro de transcrição', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/transcriptions');
      assert.equal(options.method, 'POST');
      assert.ok(options.body instanceof Blob);
      assert.equal(options.headers['Content-Type'], 'audio/webm');
      return Response.json({ text: 'Quero uma pizza' });
    };
    assert.equal(await transcribeAudio(new Blob(['audio'], { type: 'audio/webm' })), 'Quero uma pizza');
    globalThis.fetch = async () => Response.json({ error: 'Modelo não instalado' }, { status: 503 });
    await assert.rejects(transcribeAudio(new Blob(['audio'], { type: 'audio/webm' })), /Modelo não instalado/);
  } finally { globalThis.fetch = previous; }
});

test('restaura áudio interrompido como erro recuperável e preserva mensagens de texto', () => {
  const memory = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) } });
  try {
    const text = createMessage('user', 'Olá');
    const voice = { ...createMessage('user', ''), type: 'audio', audio: { id: 'voice-1', mimeType: 'audio/webm', transcriptionStatus: 'pending' } };
    saveConversation({ id: 'conversation', messages: [text, voice] });
    const restored = loadConversation();
    assert.deepEqual(restored.messages[0], text);
    assert.equal(restored.messages[1].audio.transcriptionStatus, 'error');
    assert.match(restored.messages[1].audio.transcriptionError, /interrompida/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});
