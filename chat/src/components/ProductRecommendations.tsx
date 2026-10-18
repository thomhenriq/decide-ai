import { useState } from 'react';
import type { ProductRecommendation } from '../types';
import { formatProductCaption, splitMessageText } from '../services/whatsappFormatting';
import { MessageMeta } from './MessageMeta';

function ProductPhotoMessage({ product, choice, createdAt }: { product: ProductRecommendation; choice: number; createdAt: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  return <article className="message message--assistant message--product-photo" role="listitem" aria-label={`Assistente: Escolha ${choice}, ${product.name}`}>
    {product.imageUrl && !imageFailed && <a className="product-photo" href={product.imageUrl} target="_blank" rel="noopener noreferrer" aria-label={`Abrir foto de ${product.name}`}>
      <img src={product.imageUrl} alt={product.name} loading="lazy" onError={() => setImageFailed(true)} />
    </a>}
    {(!product.imageUrl || imageFailed) && <p className="product-photo__missing">Foto não disponível</p>}
    <p className="product-caption">{formatProductCaption(product, choice)}</p>
    <MessageMeta createdAt={createdAt} />
  </article>;
}

/** Um produto por mensagem: foto e legenda comum, como no WhatsApp, numeradas como Escolha 1, 2 e 3. */
export function ProductRecommendations({ products, text, createdAt }: { products: ProductRecommendation[]; text: string; createdAt: string }) {
  return <section className="product-messages" role="list" aria-label="Recomendações por mensagem">
    {splitMessageText(text).map((part, index) => <article className="message message--assistant" role="listitem" aria-label="Assistente" key={`intro-${index}`}><p>{part}</p><MessageMeta createdAt={createdAt} /></article>)}
    {products.map((product, index) => <div className="product-messages__item" key={product.id}>
      <ProductPhotoMessage product={product} choice={index + 1} createdAt={createdAt} />
      {product.url && <article className="message message--assistant" role="listitem" aria-label={`Link de ${product.name}`}><p><a href={product.url} target="_blank" rel="noopener noreferrer">{product.url}</a></p><MessageMeta createdAt={createdAt} /></article>}
    </div>)}
  </section>;
}
