import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;

class UploadError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function readImage(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) {
        chunks.length = 0;
        if (!exceeded) reject(new UploadError(413, 'A imagem deve ter no máximo 5 MB.'));
        exceeded = true;
      } else if (!exceeded) chunks.push(chunk);
    });
    request.on('end', () => { if (!exceeded) resolveBody(Buffer.concat(chunks)); });
    request.on('error', reject);
    request.on('aborted', () => reject(new UploadError(400, 'O envio da imagem foi interrompido.')));
  });
}

function matchesType(data, type) {
  if (type === 'image/jpeg') return data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (type === 'image/png') return data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.toString('ascii', 12, 16) === 'IHDR';
  return type === 'image/webp' && data.length >= 16 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
}

/** Guarda os arquivos na pasta temp, sempre com nomes gerados pelo servidor. */
export function createImageHandlers({ directory = resolve(process.cwd(), 'temp') } = {}) {
  return {
    upload: async (request, response) => {
      try {
        if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); throw new UploadError(405, 'Use POST para enviar uma imagem.'); }
        if (request.headers.origin) {
          let host;
          try { host = new URL(request.headers.origin).host; } catch { /* Origem inválida. */ }
          if (host !== request.headers.host) throw new UploadError(403, 'Origem não permitida.');
        }
        const mimeType = (request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        const extension = TYPES[mimeType];
        if (!extension) throw new UploadError(415, 'Use uma imagem JPG, PNG ou WebP.');
        if (Number(request.headers['content-length']) > MAX_IMAGE_BYTES) throw new UploadError(413, 'A imagem deve ter no máximo 5 MB.');
        const bytes = await readImage(request);
        if (!bytes.length) throw new UploadError(400, 'O arquivo de imagem está vazio.');
        if (!matchesType(bytes, mimeType)) throw new UploadError(415, 'O conteúdo do arquivo não corresponde a uma imagem JPG, PNG ou WebP válida.');
        const id = randomUUID();
        const filename = `${id}.${extension}`;
        let originalName = `imagem.${extension}`;
        try { originalName = decodeURIComponent(request.headers['x-file-name'] || originalName).split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200) || originalName; } catch { /* Usa nome padrão. */ }
        await mkdir(directory, { recursive: true });
        await writeFile(resolve(directory, filename), bytes, { flag: 'wx' });
        json(response, 201, {
          id, mimeType, size: bytes.length, originalName,
          url: `/api/images/${filename}`,
          relativePath: `temp/${filename}`,
        });
      } catch (error) {
        json(response, error instanceof UploadError ? error.status : 500, { error: error instanceof UploadError ? error.message : 'Não foi possível salvar a imagem no servidor. Tente novamente.' });
      } finally { request.resume(); }
    },
    serve: async (request, response) => {
      try {
        if (request.method !== 'GET' && request.method !== 'HEAD') { response.setHeader('Allow', 'GET, HEAD'); throw new UploadError(405, 'Método não permitido.'); }
        const pathname = (request.url || '').split('?')[0];
        const parts = pathname.split('/');
        if (parts.length !== 4 || parts[1] !== 'api' || parts[2] !== 'images' || !FILE.test(parts[3])) throw new UploadError(404, 'Imagem não encontrada.');
        const bytes = await readFile(resolve(directory, parts[3]));
        const extension = parts[3].split('.').pop();
        response.writeHead(200, {
          'Content-Type': extension === 'jpg' ? 'image/jpeg' : `image/${extension}`,
          'Content-Length': bytes.length,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, max-age=31536000, immutable',
        });
        response.end(request.method === 'HEAD' ? undefined : bytes);
      } catch (error) {
        json(response, error instanceof UploadError ? error.status : error.code === 'ENOENT' ? 404 : 500, { error: 'Imagem não encontrada ou indisponível.' });
      }
    },
  };
}
