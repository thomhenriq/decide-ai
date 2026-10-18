import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { BrandLogo } from './BrandLogo';
import { MessageBubble } from './MessageBubble';
import { onRestaurantMessageSent } from '../services/agent';
import { createMessage, loadConversation, saveConversation } from '../services/storage';
import { createRestaurantDemoConversation, prepareWeeklyInsight, RESTAURANT_ID, RESTAURANT_STORAGE_KEY } from '../services/restaurantInsights';
import type { Conversation, WeeklyInsight } from '../types';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' });
const noAudio = () => {};

export function RestaurantChat({ preview = false }: { preview?: boolean }) {
  const [conversation, setConversation] = useState<Conversation>(() => preview
    ? createRestaurantDemoConversation() : loadConversation(RESTAURANT_STORAGE_KEY, createRestaurantDemoConversation));
  const current = useRef(conversation);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const scrollArea = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);

  const update = useCallback((next: Conversation) => {
    current.current = next;
    setConversation(next);
  }, []);

  useEffect(() => {
    if (!preview && !saveConversation(conversation, RESTAURANT_STORAGE_KEY)) {
      setNotice('O histórico ficará disponível apenas enquanto esta página estiver aberta.');
    }
  }, [conversation, preview]);

  const receiveWeeklyInsight = useCallback((insight: WeeklyInsight): boolean => {
    try {
      const result = prepareWeeklyInsight(insight, current.current, RESTAURANT_ID);
      if (result.status === 'ignored') return false;
      if (result.status === 'duplicate') return true;
      update({ ...current.current, messages: [...current.current.messages, {
        ...createMessage('assistant', result.insight.text), id: result.insight.messageId,
      }] });
      return true;
    } catch (error) {
      console.warn('[restaurant:insight:invalid]', error instanceof Error ? error.message : 'Resumo inválido.');
      return false;
    }
  }, [update]);

  useEffect(() => {
    const bridge = { receiveWeeklyInsight };
    window.restaurantChat = bridge;
    return () => { if (window.restaurantChat === bridge) delete (window as Partial<Window>).restaurantChat; };
  }, [receiveWeeklyInsight]);

  useEffect(() => {
    const area = scrollArea.current;
    if (area && nearBottom.current) area.scrollTop = area.scrollHeight;
  }, [conversation.messages]);

  useEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 112)}px`;
  }, [draft]);

  async function sendMessage() {
    const content = draft.trim();
    if (!content) return;
    const message = createMessage('user', content);
    const next = { ...current.current, messages: [...current.current.messages, message] };
    nearBottom.current = true;
    update(next);
    setDraft('');
    setNotice('');
    input.current?.focus();
    try {
      await onRestaurantMessageSent({ restaurantId: RESTAURANT_ID, conversationId: next.id, message, history: next.messages });
    } catch {
      setNotice('A resposta ficou no chat, mas houve uma falha ao acionar a integração.');
    }
  }

  return <section className="phone restaurant-phone" aria-label="Conversa do restaurante com Decide Aí">
    <header className="chat-header">
      <div className="avatar"><BrandLogo symbol /></div>
      <div className="contact"><h1>Decide Aí</h1><p>Insights para seu restaurante</p></div>
    </header>
    <div className="context-strip"><span className="context-dot" />Resumo semanal · exemplo com dados ilustrativos</div>
    <div className="chat-body" ref={scrollArea} onScroll={event => {
      const area = event.currentTarget;
      nearBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 80;
    }}>
      <div className="messages" role="log" aria-label="Mensagens do restaurante" aria-live="polite" aria-relevant="additions text">
        {conversation.messages.map((message, index, messages) => <div className="message-group" key={message.id}>
          {(index === 0 || new Date(messages[index - 1].createdAt).toDateString() !== new Date(message.createdAt).toDateString()) &&
            <div className="date-divider"><span>{new Date(message.createdAt).toDateString() === new Date().toDateString() ? 'Hoje' : dateFormat.format(new Date(message.createdAt))}</span></div>}
          <MessageBubble message={message} onRetryAudio={noAudio} userLabel="Restaurante" assistantLabel="Decide Aí" />
        </div>)}
      </div>
    </div>
    <footer className="chat-footer">
      {notice && <div className="notice" role="status">{notice}<button type="button" onClick={() => setNotice('')} aria-label="Fechar aviso do restaurante"><Icon name="close" size={16} /></button></div>}
      <form className="composer" onSubmit={event => { event.preventDefault(); void sendMessage(); }}>
        <div className="input-wrap"><textarea ref={input} aria-label="Mensagem do restaurante" placeholder="Mensagem" rows={1} maxLength={10000} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage(); }
        }} /></div>
        <button type="submit" className="send-button" disabled={!draft.trim()} aria-label="Enviar mensagem do restaurante"><Icon name="send" size={23} /></button>
      </form>
      <p className="footer-note"><span>Protótipo de hackathon</span><span aria-hidden="true">·</span><span>Sem envio real ao WhatsApp</span></p>
    </footer>
  </section>;
}
