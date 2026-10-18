import type { MessageSentPayload } from '../types';

/**
 * Trigger: executado uma vez para cada mensagem enviada pelo usuário.
 * Conecte seu agente aqui depois. Se retornar texto, ele aparece no chat.
 * Para respostas que chegam depois, use window.chat.receiveMessage(texto).
 * Não coloque chaves privadas no frontend; use um backend na integração real.
 */
export async function onMessageSent(payload: MessageSentPayload): Promise<string | void> {
  console.info('[chat:message:sent]', payload.message.type === 'image' ? payload.message.image : payload.message.content, payload);
}
