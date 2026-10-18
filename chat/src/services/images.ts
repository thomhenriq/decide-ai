import type { ImageAttachment } from '../types';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateImage(file: File): void {
  if (!SUPPORTED_TYPES.includes(file.type.toLowerCase())) throw new Error('Escolha uma imagem JPG, PNG ou WebP.');
  if (!file.size) throw new Error('O arquivo de imagem está vazio.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('A imagem deve ter no máximo 5 MB.');
}

export async function uploadImage(file: File): Promise<ImageAttachment> {
  validateImage(file);
  const response = await fetch('/api/images', {
    method: 'POST',
    headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || 'Não foi possível salvar a imagem. Verifique se o servidor foi reiniciado.');
  if (typeof result?.id !== 'string' || !/^\/api\/images\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(result?.url || '') ||
    typeof result.relativePath !== 'string' || !SUPPORTED_TYPES.includes(result.mimeType) || typeof result.size !== 'number' || typeof result.originalName !== 'string') {
    throw new Error('O servidor retornou uma resposta inválida para a imagem.');
  }
  return result;
}
