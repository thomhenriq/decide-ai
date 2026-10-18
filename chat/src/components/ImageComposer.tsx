import { useEffect, useRef, useState } from 'react';
import { validateImage } from '../services/images';
import { Icon } from './Icon';

export function ImageComposer({ onSend }: { onSend: (file: File, caption: string) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!file) { setUrl(''); return; }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    dialog.current?.showModal();
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  function close() {
    if (sending) return;
    dialog.current?.close();
    setFile(null);
    setCaption('');
    setError('');
    setReady(false);
  }

  function selectFile(selected?: File) {
    setError('');
    if (!selected) return;
    try { validateImage(selected); setReady(false); setFile(selected); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível abrir a imagem.'); }
  }

  async function send() {
    if (!file || !ready || sending) return;
    setSending(true);
    setError('');
    try {
      await onSend(file, caption.trim());
      dialog.current?.close();
      setFile(null);
      setCaption('');
      setReady(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível enviar a imagem.'); }
    finally { setSending(false); }
  }

  return <>
    <input className="visually-hidden" ref={input} type="file" tabIndex={-1} aria-label="Escolher imagem" accept="image/jpeg,image/png,image/webp" onChange={event => { selectFile(event.target.files?.[0]); event.target.value = ''; }} />
    <button type="button" className="image-attach" onClick={() => input.current?.click()}><Icon name="attach" size={17} />Anexar imagem</button>
    {!file && error && <span className="image-selection-error" role="alert">{error}</span>}
    <dialog className="image-dialog" ref={dialog} aria-labelledby="image-dialog-title" onCancel={event => { event.preventDefault(); close(); }}>
      <form onSubmit={event => { event.preventDefault(); void send(); }}>
        <header><h2 id="image-dialog-title">Enviar imagem</h2><button type="button" aria-label="Fechar prévia da imagem" disabled={sending} onClick={close}><Icon name="close" size={19} /></button></header>
        {url && <img className="image-preview" src={url} alt="Prévia da imagem selecionada" onLoad={() => setReady(true)} onError={() => { setReady(false); setError('Não foi possível ler esta imagem. Escolha outro arquivo.'); }} />}
        <label htmlFor="image-caption">Adicionar legenda <span>(opcional)</span></label>
        <textarea id="image-caption" placeholder="Quero algo parecido com isso…" rows={2} maxLength={1000} value={caption} disabled={sending} onChange={event => setCaption(event.target.value)} />
        {error && <p className="image-upload-error" role="alert">{error}</p>}
        <footer><button type="button" disabled={sending} onClick={close}>Cancelar</button><button type="submit" className="image-submit" disabled={sending || !ready}><Icon name="send" size={17} />{sending ? 'Salvando imagem…' : 'Enviar imagem'}</button></footer>
      </form>
    </dialog>
  </>;
}
