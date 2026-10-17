import type { Message } from '../types';
import { Icon } from './Icon';

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function MessageBubble({ message }: { message: Message }) {
  return (
    <article className={`message message--${message.role}`} aria-label={message.role === 'user' ? 'Você' : 'Assistente'}>
      <p>{message.content}</p>
      <span className="message__meta">
        <time dateTime={message.createdAt}>{timeFormat.format(new Date(message.createdAt))}</time>
        {message.role === 'user' && <span title="Mensagem enviada" className="message__check"><Icon name="check" size={16} /></span>}
      </span>
    </article>
  );
}
