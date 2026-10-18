import { useState } from 'react';
import type { ImageAttachment } from '../types';

export function ImageMessage({ image, caption }: { image: ImageAttachment; caption: string }) {
  const [failed, setFailed] = useState(false);
  return <div className="image-message">
    {!failed ? <a href={image.url} target="_blank" rel="noreferrer" aria-label="Abrir imagem enviada em tamanho original"><img src={image.url} alt={caption || 'Imagem enviada por você'} onError={() => setFailed(true)} /></a>
      : <span className="image-message__missing">A imagem não está disponível. Verifique se o servidor está aberto e se o arquivo continua salvo.</span>}
    {caption && <p>{caption}</p>}
  </div>;
}
