export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const extensions = new Map([
  ['audio/webm', 'webm'], ['video/webm', 'webm'], ['audio/ogg', 'ogg'],
  ['audio/mp4', 'm4a'], ['video/mp4', 'mp4'], ['audio/x-m4a', 'm4a'],
  ['audio/mpeg', 'mp3'], ['audio/mp3', 'mp3'], ['audio/mpga', 'mpga'],
  ['audio/wav', 'wav'], ['audio/x-wav', 'wav'], ['audio/wave', 'wav'],
  ['audio/flac', 'flac'], ['audio/x-flac', 'flac'],
]);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function readAudio(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let oversized = false;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_AUDIO_BYTES) {
        chunks.length = 0;
        if (!oversized) reject(new HttpError(413, 'O áudio deve ter no máximo 20 MB.'));
        oversized = true;
      } else if (!oversized) chunks.push(chunk);
    });
    request.on('end', () => { if (!oversized) resolve(Buffer.concat(chunks)); });
    request.on('error', reject);
    request.on('aborted', () => reject(new HttpError(400, 'O envio do áudio foi interrompido.')));
  });
}

/** Middleware Node, reutilizável em outro backend. O áudio é processado localmente. */
export function createTranscriptionHandler({ transcribe }) {
  return async (request, response) => {
    const abort = new AbortController();
    const onClose = () => { if (!response.writableEnded) abort.abort(); };
    response.on('close', onClose);
    try {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        throw new HttpError(405, 'Use POST para enviar um áudio.');
      }
      if (request.headers.origin) {
        let originHost;
        try { originHost = new URL(request.headers.origin).host; } catch { /* Origem inválida. */ }
        if (originHost !== request.headers.host) throw new HttpError(403, 'Origem não permitida.');
      }
      const mimeType = (request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const extension = extensions.get(mimeType);
      if (!extension) throw new HttpError(415, 'Formato não suportado. Use WebM, MP3, M4A, MP4, OGG, WAV ou FLAC.');
      if (Number(request.headers['content-length']) > MAX_AUDIO_BYTES) throw new HttpError(413, 'O áudio deve ter no máximo 20 MB.');
      const audio = await readAudio(request);
      if (!audio.length) throw new HttpError(400, 'O arquivo de áudio está vazio.');
      const text = await transcribe(audio, { mimeType, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(150_000)]) });
      if (typeof text !== 'string' || !text.trim()) throw new HttpError(422, 'Não foi possível identificar fala neste áudio.');
      json(response, 200, { text: text.trim() });
    } catch (error) {
      if (abort.signal.aborted) return;
      const status = Number.isInteger(error?.status) ? error.status : error?.name === 'TimeoutError' ? 504 : 502;
      const message = Number.isInteger(error?.status) ? error.message : status === 504 ? 'A transcrição demorou demais. Tente novamente.' : 'Não foi possível concluir a transcrição. Tente novamente.';
      json(response, status, { error: message });
    } finally {
      request.resume();
      response.off('close', onClose);
    }
  };
}
