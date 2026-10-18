export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', mpga: 'audio/mpeg',
  m4a: 'audio/mp4', mp4: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac',
};
const SUPPORTED_MIMES = new Set([
  ...Object.values(MIME_BY_EXTENSION), 'video/webm', 'video/mp4',
  'audio/x-m4a', 'audio/mp3', 'audio/mpga', 'audio/x-wav', 'audio/wave', 'audio/x-flac',
]);

export function prepareAudio(file: Blob, filename = ''): Blob {
  if (!file.size) throw new Error('O arquivo de áudio está vazio.');
  if (file.size > MAX_AUDIO_BYTES) throw new Error('O áudio deve ter no máximo 20 MB.');
  const mimeType = file.type.split(';')[0].toLowerCase() || MIME_BY_EXTENSION[filename.split('.').pop()?.toLowerCase() || ''];
  if (!SUPPORTED_MIMES.has(mimeType)) throw new Error('Use um áudio WebM, MP3, M4A, MP4, OGG, WAV ou FLAC.');
  return new Blob([file], { type: mimeType });
}

export async function transcribeAudio(audio: Blob, signal?: AbortSignal): Promise<string> {
  const response = await fetch('/api/transcriptions', {
    method: 'POST', headers: { 'Content-Type': audio.type }, body: audio,
    signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(180_000)]),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || 'Não foi possível transcrever o áudio. Verifique se o servidor foi reiniciado.');
  if (typeof result?.text !== 'string' || !result.text.trim()) throw new Error('Não foi possível identificar fala neste áudio.');
  return result.text.trim();
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
