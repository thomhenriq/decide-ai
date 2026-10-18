import type { Message } from '../types';
import { AudioMessage } from './AudioMessage';
import { ImageMessage } from './ImageMessage';
import { ProductRecommendations } from './ProductRecommendations';
import { MessageMeta } from './MessageMeta';
import { splitMessageText } from '../services/whatsappFormatting';

export function MessageBubble({ message, onRetryAudio, userLabel = 'Você', assistantLabel = 'Assistente' }: { message: Message; onRetryAudio: (id: string) => void; userLabel?: string; assistantLabel?: string }) {
  if (message.type === 'products' && message.products) return <ProductRecommendations products={message.products} text={message.content} createdAt={message.createdAt} />;
  if (message.role === 'assistant') return <>{splitMessageText(message.content).map((text, index) => <article className="message message--assistant" aria-label={assistantLabel} key={`${message.id}-${index}`}><p>{text}</p><MessageMeta createdAt={message.createdAt} /></article>)}</>;
  return (
    <article className={`message message--${message.role}`} aria-label={message.role === 'user' ? userLabel : assistantLabel}>
      {message.type === 'audio' && message.audio ? <AudioMessage message={message} onRetry={onRetryAudio} />
        : message.type === 'image' && message.image ? <ImageMessage image={message.image} caption={message.content} /> : <p>{message.content}</p>}
      <MessageMeta createdAt={message.createdAt} sent={message.role === 'user'} />
    </article>
  );
}
