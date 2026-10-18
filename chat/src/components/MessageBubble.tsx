import type { Message } from '../types';
import { Icon } from './Icon';
import { AudioMessage } from './AudioMessage';
import { ImageMessage } from './ImageMessage';

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function MessageBubble({ message, onRetryAudio }: { message: Message; onRetryAudio: (id: string) => void }) {
  return (
    <article className={`message message--${message.role}`} aria-label={message.role === 'user' ? 'Você' : 'Assistente'}>
      {message.type === 'audio' && message.audio ? <AudioMessage message={message} onRetry={onRetryAudio} />
        : message.type === 'image' && message.image ? <ImageMessage image={message.image} caption={message.content} /> : <p>{message.content}</p>}
      <span className="message__meta">
        <time dateTime={message.createdAt}>{timeFormat.format(new Date(message.createdAt))}</time>
        {message.role === 'user' && <span title="Mensagem enviada" className="message__check"><Icon name="check" size={16} /></span>}
      </span>
    </article>
  );
}
