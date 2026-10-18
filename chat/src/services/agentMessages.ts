import type { AgentResponse, Conversation, ProductRecommendation } from '../types';

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= max;
}

function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
}

function optional(value: unknown, valid: (value: unknown) => boolean): boolean {
  return value === undefined || valid(value);
}

export function isSafeProductUrl(value: unknown): value is string {
  if (!text(value, 2048)) return false;
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') && !/[\u0000-\u0020]/.test(value)) return true;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function isProductRecommendation(value: unknown): value is ProductRecommendation {
  if (!object(value) || !text(value.id, 128) || !text(value.name, 160) || !object(value.restaurant) || !text(value.restaurant.name, 160)) return false;
  const restaurant = value.restaurant;
  if (!optional(value.description, value => text(value, 1000)) || !optional(value.imageUrl, isSafeProductUrl) ||
    !optional(value.url, isSafeProductUrl) || !optional(value.priceCents, integer) || !optional(value.originalPriceCents, integer) ||
    !optional(restaurant.id, value => text(value, 128)) ||
    !optional(restaurant.rating, value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5) ||
    !optional(restaurant.ratingCount, integer)) return false;
  if (value.delivery !== undefined) {
    if (!object(value.delivery)) return false;
    const delivery = value.delivery;
    if (!optional(delivery.feeCents, integer) || !optional(delivery.minMinutes, value => integer(value, 1440)) ||
      !optional(delivery.maxMinutes, value => integer(value, 1440))) return false;
    if (typeof delivery.minMinutes === 'number' && typeof delivery.maxMinutes === 'number' && delivery.minMinutes > delivery.maxMinutes) return false;
  }
  return true;
}

/** Validação na borda da integração: dados externos nunca viram HTML executável. */
export function normalizeAgentResponse(input: unknown): AgentResponse | null {
  if (typeof input === 'string') {
    if (!input.trim()) return null;
    if (input.length > 10000) throw new Error('A resposta de texto deve ter no máximo 10000 caracteres.');
    return { type: 'text', text: input.trim() };
  }
  if (!object(input)) throw new Error('Envie uma string ou um objeto JSON de resposta do agente.');
  if (!optional(input.conversationId, value => text(value, 128)) || !optional(input.messageId, value => text(value, 128))) throw new Error('conversationId e messageId devem ser strings não vazias.');
  const metadata = { conversationId: input.conversationId as string | undefined, messageId: input.messageId as string | undefined };
  if (input.type === 'text') {
    if (!text(input.text, 10000)) throw new Error('Uma resposta text precisa de text não vazio.');
    return { ...metadata, type: 'text', text: input.text.trim() };
  }
  if (input.type !== 'products') throw new Error('Tipo de resposta desconhecido. Use text ou products.');
  if (input.text !== undefined && (typeof input.text !== 'string' || input.text.length > 10000)) throw new Error('text deve ser uma string de até 10000 caracteres.');
  if (!Array.isArray(input.products) || !input.products.length || input.products.length > 10) throw new Error('Uma resposta products deve conter de 1 a 10 produtos.');
  const ids = new Set<string>();
  const products = input.products.map((product, index): ProductRecommendation => {
    if (!isProductRecommendation(product)) throw new Error(`Produto ${index + 1} inválido. Confira nome, restaurante, valores em centavos, URLs e avaliação de 0 a 5.`);
    if (ids.has(product.id.trim())) throw new Error('Os produtos da resposta devem ter IDs diferentes.');
    ids.add(product.id.trim());
    // Cria um snapshot para que mudanças posteriores no objeto do agente não alterem o histórico.
    return {
      id: product.id.trim(), name: product.name.trim(), description: product.description?.trim(),
      imageUrl: product.imageUrl, priceCents: product.priceCents, originalPriceCents: product.originalPriceCents,
      restaurant: { ...product.restaurant, name: product.restaurant.name.trim() },
      delivery: product.delivery ? { ...product.delivery } : undefined, url: product.url,
    };
  });
  return { ...metadata, type: 'products', text: (input.text as string | undefined)?.trim(), products };
}

/** Mesmas regras para respostas por retorno do trigger e pela ponte pública. */
export function prepareAgentDelivery(input: unknown, conversation: Conversation):
  { status: 'ignored' } | { status: 'duplicate' } | { status: 'accepted'; response: AgentResponse } {
  if (!conversation.messages.some(message => message.role === 'user')) return { status: 'ignored' };
  const response = normalizeAgentResponse(input);
  if (!response || (response.conversationId !== undefined && response.conversationId !== conversation.id)) return { status: 'ignored' };
  if (response.messageId && conversation.messages.some(message => message.id === response.messageId)) return { status: 'duplicate' };
  return { status: 'accepted', response };
}
