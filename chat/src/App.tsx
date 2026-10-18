import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './components/Icon';
import { MessageBubble } from './components/MessageBubble';
import { AudioComposer } from './components/AudioComposer';
import { onMessageSent } from './services/agent';
import { prepareAudio, transcribeAudio } from './services/audio';
import { deleteAudio, loadAudio, saveAudio } from './services/audioStorage';
import { uploadImage } from './services/images';
import { createMessage, loadConversation, newConversation, saveConversation } from './services/storage';
import type { Conversation, Message } from './types';

const suggestions = ['Quero um hambúrguer 🍔', 'Algo gostoso até R$ 30', 'Hoje vou de comida vegana 🌱'];
const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' });

function dateLabel(iso: string) {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString() ? 'Hoje' : dateFormat.format(date);
}

export default function App() {
  const [conversation, setConversation] = useState<Conversation>(loadConversation);
  const current = useRef(conversation);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const cancelReset = useRef<HTMLButtonElement>(null);
  const nearBottom = useRef(true);
  const audioRequests = useRef(new Map<string, AbortController>());

  const update = useCallback((next: Conversation) => {
    current.current = next;
    setConversation(next);
  }, []);

  useEffect(() => {
    if (!saveConversation(conversation)) setNotice('O histórico ficará disponível apenas enquanto esta página estiver aberta.');
  }, [conversation]);

  useEffect(() => {
    const requests = audioRequests.current;
    return () => { requests.forEach(controller => controller.abort()); requests.clear(); };
  }, [conversation.id]);

  const receiveMessage = useCallback((text: string) => {
    if (typeof text !== 'string' || !text.trim()) return;
    if (!current.current.messages.some(message => message.role === 'user')) return;
    update({ ...current.current, messages: [...current.current.messages, createMessage('assistant', text.trim())] });
    setTyping(false);
  }, [update]);

  useEffect(() => {
    const bridge = { receiveMessage, setTyping };
    window.chat = bridge;
    return () => { if (window.chat === bridge) delete (window as Partial<Window>).chat; };
  }, [receiveMessage]);

  useEffect(() => {
    const area = scrollArea.current;
    if (area && nearBottom.current) area.scrollTop = area.scrollHeight;
  }, [conversation.messages, typing]);

  useEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 112)}px`;
  }, [draft]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); setResetOpen(false); }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);

  useEffect(() => { if (resetOpen) cancelReset.current?.focus(); }, [resetOpen]);

  async function triggerAgent(message: Message, conversationId: string) {
    if (current.current.id !== conversationId) return;
    try {
      const history = current.current.messages.filter(item => !item.audio || item.audio.transcriptionStatus === 'completed');
      const reply = await onMessageSent({ conversationId, message, history });
      if (typeof reply === 'string' && current.current.id === conversationId) receiveMessage(reply);
    } catch (error) {
      console.error('[chat:trigger:error]', error);
      if (current.current.id === conversationId) {
        setTyping(false);
        setNotice('A mensagem ficou no chat, mas houve uma falha ao acionar a integração.');
      }
    }
  }

  function updateAudioMessage(message: Message, conversationId: string) {
    if (current.current.id !== conversationId) return;
    update({ ...current.current, messages: current.current.messages.map(item => item.id === message.id ? message : item) });
  }

  async function processAudio(message: Message, blob: Blob, conversationId: string) {
    if (!message.audio || audioRequests.current.has(message.id) || current.current.id !== conversationId) return;
    const controller = new AbortController();
    audioRequests.current.set(message.id, controller);
    updateAudioMessage({ ...message, audio: { ...message.audio, transcriptionStatus: 'pending', transcriptionError: undefined } }, conversationId);
    try {
      const text = await transcribeAudio(blob, controller.signal);
      if (controller.signal.aborted || current.current.id !== conversationId) return;
      const completed: Message = { ...message, content: text, audio: { ...message.audio, transcriptionStatus: 'completed', transcriptionError: undefined } };
      updateAudioMessage(completed, conversationId);
      console.info('[chat:audio:transcribed]', text, { conversationId, messageId: message.id });
      await triggerAgent(completed, conversationId);
    } catch (error) {
      if (controller.signal.aborted || current.current.id !== conversationId) return;
      const description = error instanceof Error ? error.message : 'Não foi possível transcrever este áudio.';
      updateAudioMessage({ ...message, audio: { ...message.audio, transcriptionStatus: 'error', transcriptionError: description } }, conversationId);
      console.error('[chat:audio:transcription:error]', description);
    } finally { audioRequests.current.delete(message.id); }
  }

  async function sendAudio(blob: Blob, durationSeconds?: number) {
    const audio = prepareAudio(blob);
    const conversationId = current.current.id;
    const base = createMessage('user', '');
    const message: Message = { ...base, type: 'audio', audio: { id: base.id, mimeType: audio.type, durationSeconds, transcriptionStatus: 'pending' } };
    await saveAudio(message.id, audio);
    if (current.current.id !== conversationId) { await deleteAudio([message.id]); return; }
    nearBottom.current = true;
    setNotice('');
    update({ ...current.current, messages: [...current.current.messages, message] });
    void processAudio(message, audio, conversationId);
  }

  async function retryAudio(id: string) {
    const message = current.current.messages.find(item => item.id === id);
    const conversationId = current.current.id;
    if (!message?.audio || audioRequests.current.has(id)) return;
    try {
      const blob = await loadAudio(message.audio.id);
      if (!blob) throw new Error('Este áudio não está mais disponível. Grave novamente.');
      await processAudio(message, blob, conversationId);
    } catch (error) {
      updateAudioMessage({ ...message, audio: { ...message.audio, transcriptionStatus: 'error', transcriptionError: error instanceof Error ? error.message : 'Não foi possível recuperar o áudio.' } }, conversationId);
    }
  }

  async function sendImage(file: File, caption: string) {
    const conversationId = current.current.id;
    const image = await uploadImage(file);
    if (current.current.id !== conversationId) return;
    const message: Message = { ...createMessage('user', caption), type: 'image', image };
    nearBottom.current = true;
    setNotice('');
    update({ ...current.current, messages: [...current.current.messages, message] });
    console.info('[chat:image:saved]', image.relativePath, image);
    await triggerAgent(message, conversationId);
  }

  function resetConversation() {
    const ids = current.current.messages.flatMap(message => message.audio ? [message.audio.id] : []);
    audioRequests.current.forEach(controller => controller.abort());
    audioRequests.current.clear();
    nearBottom.current = true;
    update(newConversation());
    setTyping(false);
    setDraft('');
    setNotice('');
    setResetOpen(false);
    input.current?.focus();
    void deleteAudio(ids).catch(() => console.warn('[chat:audio:storage]', 'Não foi possível remover os arquivos da conversa anterior.'));
  }

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content) return;
    const message = createMessage('user', content);
    const next = { ...current.current, messages: [...current.current.messages, message] };
    nearBottom.current = true;
    update(next);
    setDraft('');
    setNotice('');
    input.current?.focus();
    await triggerAgent(message, next.id);
  }

  const hasUserMessages = conversation.messages.some(message => message.role === 'user');

  return (
    <main className="stage">
      <section className="phone" aria-label="Conversa com Decide Aí">
        <header className="chat-header">
          <div className="avatar"><Icon name="bowl" size={25} /></div>
          <div className="contact">
            <h1>Decide Aí <span className="verified" title="Assistente de demonstração">✓</span></h1>
            <p>Uma ajudinha na hora de escolher</p>
          </div>
          <div className="header-menu" ref={menu}>
            <button type="button" className="icon-button menu-toggle" aria-label="Opções da conversa" aria-expanded={menuOpen} aria-controls="chat-menu" onClick={() => setMenuOpen(!menuOpen)}><Icon name="more" /></button>
            {menuOpen && <div className="menu" id="chat-menu"><button type="button" onClick={() => { setMenuOpen(false); setResetOpen(true); }}>Nova conversa</button></div>}
          </div>
        </header>

        <div className="context-strip"><span className="context-dot" /> Seu próximo pedido começa com um oi</div>

        <div className="chat-body" ref={scrollArea} onScroll={event => {
          const area = event.currentTarget;
          nearBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 80;
        }}>
          <div className="intro"><span className="intro__icon"><Icon name="bowl" size={29} /></span><p>Bateu a fome?</p><span>Conversa boa. Comida também.</span></div>
          <div className="messages" role="log" aria-label="Mensagens da conversa" aria-live="polite" aria-relevant="additions text">
            {conversation.messages.map((message, index, messages) => <div key={message.id} className="message-group">
              {(index === 0 || new Date(messages[index - 1].createdAt).toDateString() !== new Date(message.createdAt).toDateString()) && <div className="date-divider"><span>{dateLabel(message.createdAt)}</span></div>}
              <MessageBubble message={message} onRetryAudio={id => void retryAudio(id)} />
            </div>)}
            {typing && <div className="typing" role="status" aria-label="Assistente digitando"><i /><i /><i /></div>}
          </div>

          {!hasUserMessages && <div className="suggestions"><p>SE PRECISAR DE UMA IDEIA</p>{suggestions.map(text => <button type="button" key={text} onClick={() => void sendMessage(text)}>{text}<span aria-hidden="true">↗</span></button>)}</div>}
        </div>

        <footer className="chat-footer">
          {notice && <div className="notice" role="status">{notice}<button type="button" onClick={() => setNotice('')} aria-label="Fechar aviso"><Icon name="close" size={16} /></button></div>}
          <AudioComposer key={conversation.id} onSend={sendAudio} onSendImage={sendImage} />
          <form className="composer" onSubmit={event => { event.preventDefault(); void sendMessage(draft); }}>
            <div className="input-wrap"><textarea ref={input} aria-label="Mensagem" placeholder="O que você está com vontade?" rows={1} maxLength={10000} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage(draft); }
            }} /></div>
            <button type="submit" className="send-button" disabled={!draft.trim()} aria-label="Enviar mensagem"><Icon name="send" size={23} /></button>
          </form>
          <p className="footer-note"><span>Feito para conversar</span><span aria-hidden="true">·</span><span>Protótipo de hackathon</span></p>
        </footer>

        {resetOpen && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setResetOpen(false); }}>
          <section className="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title" onKeyDown={event => {
            if (event.key === 'Tab') {
              const buttons = event.currentTarget.querySelectorAll('button');
              const first = buttons[0]; const last = buttons[buttons.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
          }}>
            <h2 id="reset-title">Começar de novo?</h2><p>As mensagens desta conversa serão apagadas deste navegador.</p>
            <div><button type="button" ref={cancelReset} onClick={() => { setResetOpen(false); input.current?.focus(); }}>Continuar aqui</button><button type="button" className="reset-confirm" onClick={resetConversation}>Nova conversa</button></div>
          </section>
        </div>}
      </section>
      <p className="desktop-caption"><span className="caption-mark">decide aí</span><span>Menos indecisão, mais conversa.</span></p>
    </main>
  );
}
