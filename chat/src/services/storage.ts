import type { Conversation, Message } from '../types';
import { isProductRecommendation } from './agentMessages';

const STORAGE_KEY = 'hackathon-ifood:conversation:v1';
const LEGACY_GREETING = 'Oi! Que bom te ver por aqui 👋\n\nMe conta o que você está com vontade de comer. Vamos encontrar seu próximo pedido juntos?';

function createId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  // randomUUID exige HTTPS ou localhost; getRandomValues também funciona no HTTP da rede local.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createMessage(role: Message['role'], content: string): Message {
  return { id: createId(), role, content, createdAt: new Date().toISOString() };
}

export function newConversation(): Conversation {
  return {
    id: createId(),
    messages: [],
  };
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<Message>;
  if (message.type !== undefined && !['text', 'audio', 'image', 'products'].includes(message.type)) return false;
  if (message.type === 'products' && (message.role !== 'assistant' || !Array.isArray(message.products) || !message.products.length || message.products.length > 10 || !message.products.every(isProductRecommendation))) return false;
  if (message.type === 'image') {
    const image = message.image;
    if (message.role !== 'user' || !image || typeof image.id !== 'string' ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType) ||
      !Number.isFinite(image.size) || image.size <= 0 || typeof image.originalName !== 'string' ||
      typeof image.relativePath !== 'string' || typeof image.url !== 'string' ||
      !/^\/api\/images\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(image.url)) return false;
  }
  if (message.type === 'audio') {
    if (message.role !== 'user' || !message.audio || typeof message.audio.id !== 'string' ||
      typeof message.audio.mimeType !== 'string' ||
      !['pending', 'completed', 'error'].includes(message.audio.transcriptionStatus) ||
      (message.audio.durationSeconds !== undefined && (!Number.isFinite(message.audio.durationSeconds) || message.audio.durationSeconds < 0)) ||
      (message.audio.transcriptionError !== undefined && typeof message.audio.transcriptionError !== 'string')) return false;
  }
  return typeof message.id === 'string' &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' && typeof message.createdAt === 'string' &&
    Number.isFinite(Date.parse(message.createdAt));
}

export function loadConversation(storageKey = STORAGE_KEY, fallback = newConversation): Conversation {
  try {
    const raw = localStorage.getItem(storageKey);
    const value = raw ? JSON.parse(raw) : null;
    if (value && typeof value.id === 'string' && Array.isArray(value.messages) && value.messages.every(isMessage)) {
      // Retira a saudação da versão anterior sem apagar a conversa do usuário.
      return {
        ...value,
        messages: value.messages.filter((message: Message, index: number) =>
          !(index === 0 && message.role === 'assistant' && message.content === LEGACY_GREETING))
          .map((message: Message) => message.audio?.transcriptionStatus === 'pending' ? {
            ...message, audio: { ...message.audio, transcriptionStatus: 'error', transcriptionError: 'A transcrição foi interrompida. Tente novamente.' },
          } : message),
      };
    }
  } catch { /* Armazenamento indisponível ou histórico inválido: inicia em memória. */ }
  return fallback();
}

export function saveConversation(conversation: Conversation, storageKey = STORAGE_KEY): boolean {
  try {
    localStorage.setItem(storageKey, JSON.stringify(conversation));
    return true;
  } catch {
    return false;
  }
}
