import { Icon } from './Icon';

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function MessageMeta({ createdAt, sent = false }: { createdAt: string; sent?: boolean }) {
  return <span className="message__meta">
    <time dateTime={createdAt}>{timeFormat.format(new Date(createdAt))}</time>
    {sent && <span title="Mensagem enviada" className="message__check"><Icon name="check" size={16} /></span>}
  </span>;
}
