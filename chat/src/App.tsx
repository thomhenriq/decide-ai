import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './components/Icon';
import { MessageBubble } from './components/MessageBubble';
import { AudioComposer } from './components/AudioComposer';
import { RestaurantChat } from './components/RestaurantChat';
import { BrandLogo } from './components/BrandLogo';
import { useChatPages } from './components/useChatPages';
import { useTextareaAutosize } from './components/useTextareaAutosize';
import { onMessageSent } from './services/agent';
import { getUserLocation } from './services/location';
import { prepareAgentDelivery } from './services/agentMessages';
import { prepareAudio, transcribeAudio } from './services/audio';
import { deleteAudio, loadAudio, saveAudio } from './services/audioStorage';
import { uploadImage } from './services/images';
import { createMessage, loadConversation, newConversation, saveConversation } from './services/storage';
import type { AgentResponse, Conversation, Message } from './types';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' });

function dateLabel(iso: string) {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString() ? 'Hoje' : dateFormat.format(date);
}

function createAgentMessage(response: AgentResponse): Message {
  const base = createMessage('assistant', response.text || '');
  return response.type === 'products'
    ? { ...base, id: response.messageId || base.id, type: 'products', products: response.products }
    : { ...base, id: response.messageId || base.id };
}

type AppProps = { previewResponse?: AgentResponse; previewTemplates?: { label: string; response: AgentResponse }[] };

export default function App(props: AppProps) {
  const { stage, activePage } = useChatPages();
  return <main className="stage" ref={stage}>
    <div className="chat-workspace">
      <section className="chat-panel" aria-labelledby="client-panel-title" data-page-active={activePage === 0}>
        <div className="panel-heading"><h2 id="client-panel-title">Cliente</h2><p>Uma conversa para decidir o próximo pedido.</p></div>
        <ClientChat {...props} />
      </section>
      <section className="chat-panel" aria-labelledby="restaurant-panel-title" data-page-active={activePage === 1}>
        <div className="panel-heading"><h2 id="restaurant-panel-title">Restaurante</h2><p>O Decide Aí envia os insights ao final da semana.</p></div>
        <RestaurantChat preview={!!props.previewResponse} />
      </section>
    </div>
    <p className="desktop-caption"><BrandLogo wordmark /><span>Menos indecisão, mais conversa.</span></p>
  </main>;
}

function ClientChat({ previewResponse, previewTemplates }: AppProps) {
  const [conversation, setConversation] = useState<Conversation>(() => previewResponse
    ? { ...newConversation(), messages: [createMessage('user', 'Quero algumas opções para jantar.'), createAgentMessage(previewResponse)] }
    : loadConversation());
  const current = useRef(conversation);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const input = useTextareaAutosize(draft);
  const scrollArea = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const cancelReset = useRef<HTMLButtonElement>(null);
  const nearBottom = useRef(true);
  const audioRequests = useRef(new Map<string, AbortController>());

  const update = useCallback((next: Conversation) => {
    current.current = next;
    setConversation(next);
  }, []);

  // Pede a localização ao abrir o chat, para a primeira busca já sair perto do cliente.
  useEffect(() => {
    if (previewResponse) return;
    void getUserLocation().then(location => {
      if (!location) setNotice('Sem acesso à localização. Vou perguntar seu endereço na conversa. Para usar o GPS, libere a localização no navegador.');
    });
  }, [previewResponse]);

  useEffect(() => {
    if (previewResponse) return;
    if (!saveConversation(conversation)) setNotice('O histórico ficará disponível apenas enquanto esta página estiver aberta.');
  }, [conversation, previewResponse]);

  useEffect(() => {
    const requests = audioRequests.current;
    return () => { requests.forEach(controller => controller.abort()); requests.clear(); };
  }, [conversation.id]);

  const receiveMessage = useCallback((input: string | AgentResponse): boolean => {
    let delivery: ReturnType<typeof prepareAgentDelivery>;
    try { delivery = prepareAgentDelivery(input, current.current); }
    catch (error) { console.warn('[chat:agent:invalid]', error instanceof Error ? error.message : 'Resposta inválida.'); return false; }
    if (delivery.status === 'ignored') return false;
    if (delivery.status === 'duplicate') { setTyping(false); return true; }
    update({ ...current.current, messages: [...current.current.messages, createAgentMessage(delivery.response)] });
    setTyping(false);
    return true;
  }, [update]);

  useEffect(() => {
    const bridge = { receiveMessage, receiveAgentMessage: receiveMessage, setTyping };
    window.chat = bridge;
    return () => { if (window.chat === bridge) delete (window as Partial<Window>).chat; };
  }, [receiveMessage]);

  useEffect(() => {
    const area = scrollArea.current;
    if (area && nearBottom.current) area.scrollTop = area.scrollHeight;
  }, [conversation.messages, typing]);

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
      if (reply !== undefined && current.current.id === conversationId && !receiveMessage(reply)) {
        setTyping(false);
        setNotice('O agente respondeu em um formato inválido. Tente de novo.');
      }
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
    // O modal aguarda apenas o upload; a resposta do agente segue no chat.
    void triggerAgent(message, conversationId);
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
      <section className="phone" aria-label="Conversa com Decide Aí">
        <header className="chat-header">
          <div className="avatar"><BrandLogo symbol /></div>
          <div className="contact">
            <h1>Decide Aí <span className="verified" title="Assistente de demonstração">✓</span></h1>
            <p>Uma ajudinha na hora de escolher</p>
          </div>
          <div className="header-menu" ref={menu}>
            <button type="button" className="icon-button menu-toggle" aria-label="Opções da conversa" aria-expanded={menuOpen} aria-controls="chat-menu" onClick={() => setMenuOpen(!menuOpen)}><Icon name="more" /></button>
            {menuOpen && <div className="menu" id="chat-menu"><button type="button" onClick={() => { setMenuOpen(false); setResetOpen(true); }}>Nova conversa</button></div>}
          </div>
        </header>

        <div className="context-strip"><span className="context-dot" />{previewResponse ? 'Prévia dos modelos · dados e imagens ilustrativos' : 'Seu próximo pedido começa com um oi'}</div>

        {previewResponse && previewTemplates && <aside className="preview-controls" aria-label="Testar modelos de mensagem">
          <div><span>Simular resposta do agente</span><a href="/">Voltar ao chat</a></div>
          <div>{previewTemplates.map(template => <button type="button" key={template.label} onClick={() => {
            nearBottom.current = true;
            if (!current.current.messages.some(message => message.role === 'user')) {
              update({ ...current.current, messages: [...current.current.messages, createMessage('user', 'Quero algumas opções para jantar.')] });
            }
            receiveMessage(template.response);
          }}>{template.label}</button>)}</div>
        </aside>}

        <div className="chat-body" ref={scrollArea} onScroll={event => {
          const area = event.currentTarget;
          nearBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 80;
        }}>
          {!hasUserMessages && <div className="intro"><span className="intro__icon"><BrandLogo symbol /></span><p>Bateu a fome?</p><span>Conversa boa. Comida também.</span></div>}
          <div className="messages" role="log" aria-label="Mensagens da conversa" aria-live="polite" aria-relevant="additions text">
            {conversation.messages.map((message, index, messages) => <div key={message.id} className="message-group">
              {(index === 0 || new Date(messages[index - 1].createdAt).toDateString() !== new Date(message.createdAt).toDateString()) && <div className="date-divider"><span>{dateLabel(message.createdAt)}</span></div>}
              <MessageBubble message={message} onRetryAudio={id => void retryAudio(id)} />
            </div>)}
            {typing && <div className="typing" role="status" aria-label="Assistente digitando"><i /><i /><i /></div>}
          </div>

        </div>

        <footer className="chat-footer">
          {notice && <div className="notice" role="status">{notice}<button type="button" onClick={() => setNotice('')} aria-label="Fechar aviso"><Icon name="close" size={16} /></button></div>}
          <AudioComposer key={conversation.id} onSend={sendAudio} onSendImage={sendImage} />
          <form className="composer" onSubmit={event => { event.preventDefault(); void sendMessage(draft); }}>
            <label className="input-wrap"><textarea ref={input} aria-label="Mensagem" placeholder="O que você está com vontade?" rows={1} maxLength={10000} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage(draft); }
            }} /></label>
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
  );
}
