import example from '../../public/examples/weekly-insight.json';
import type { Conversation, WeeklyInsight } from '../types';
import { createMessage, newConversation } from './storage';

export const RESTAURANT_ID = 'restaurante-demo';
export const RESTAURANT_STORAGE_KEY = 'decide-ai:restaurant:conversation:v1';

export function prepareWeeklyInsight(input: unknown, conversation: Conversation, restaurantId: string):
  { status: 'ignored' } | { status: 'duplicate' } | { status: 'accepted'; insight: WeeklyInsight } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Envie um objeto de resumo semanal.');
  const value = input as Record<string, unknown>;
  const validId = (id: unknown): id is string => typeof id === 'string' && !!id.trim() && id.length <= 128;
  if (value.type !== 'weekly_insight' || !validId(value.restaurantId) || !validId(value.messageId) ||
    typeof value.text !== 'string' || !value.text.trim() || value.text.length > 10000) {
    throw new Error('Resumo inválido: informe type, restaurantId, messageId e text (até 10000 caracteres).');
  }
  if (value.restaurantId !== restaurantId) return { status: 'ignored' };
  const messageId = value.messageId.trim();
  if (conversation.messages.some(message => message.id === messageId)) return { status: 'duplicate' };
  return { status: 'accepted', insight: { type: 'weekly_insight', restaurantId, messageId, text: value.text.trim() } };
}

export function createRestaurantDemoConversation(): Conversation {
  const conversation = newConversation();
  return { ...conversation, messages: [{ ...createMessage('assistant', example.text), id: example.messageId }] };
}
