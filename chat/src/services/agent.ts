import type { AgentRequest, AgentResponse, MessageSentPayload } from '../types';
import { getUserLocation } from './location';

type AgentEvent =
  | { type: 'status'; response: AgentResponse }
  | { type: 'reply'; response: AgentResponse }
  | { type: 'error'; error: string };

/**
 * Trigger: executado uma vez para cada mensagem enviada pelo usuário.
 * Envia a conversa e a localização autorizada para /api/agent (server/agent.mjs), que consulta o Claude com o MCP do iFood.
 * O backend responde em NDJSON: avisos intermediários, como "vou buscar", entram no chat assim que chegam, e a resposta final é retornada.
 */
export async function onMessageSent(payload: MessageSentPayload): Promise<string | AgentResponse | void> {
  console.info('[chat:message:sent]', payload.message.type === 'image' ? payload.message.image : payload.message.content, payload);
  window.chat?.setTyping(true);
  const request: AgentRequest = { ...payload, location: await getUserLocation() };
  const response = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `O agente respondeu com status ${response.status}.`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += value ?? '';
    const lines = done ? [buffer] : buffer.split('\n');
    buffer = done ? '' : lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as AgentEvent;
      if (event.type === 'error') throw new Error(event.error);
      if (event.type === 'reply') { console.info('[chat:agent:reply]', event.response); return event.response; }
      // Aviso intermediário: aparece no chat e o indicador de digitação continua até a resposta final.
      window.chat?.receiveAgentMessage(event.response);
      window.chat?.setTyping(true);
    }
    if (done) throw new Error('O agente encerrou a conexão sem responder.');
  }
}

/**
 * Canal separado: respostas do restaurante não entram no histórico do cliente.
 * Envia a mensagem para /api/restaurant/agent (server/restaurant-agent.mjs), que calcula os insights
 * da semana no banco e responde com o texto para o restaurante.
 */
export async function onRestaurantMessageSent(payload: MessageSentPayload & { restaurantId: string }): Promise<{ text: string; messageId: string }> {
  console.info('[restaurant:message:sent]', payload.message.content, payload);
  const response = await fetch('/api/restaurant/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.text !== 'string') throw new Error(body?.error || `O agente do restaurante respondeu com status ${response.status}.`);
  console.info('[restaurant:agent:reply]', body);
  return body;
}
