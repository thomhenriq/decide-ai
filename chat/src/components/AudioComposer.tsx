import { useEffect, useRef, useState } from 'react';
import { formatDuration, prepareAudio } from '../services/audio';
import { Icon } from './Icon';
import { ImageComposer } from './ImageComposer';

interface AudioDraft { blob: Blob; durationSeconds?: number }
type Phase = 'idle' | 'requesting' | 'recording' | 'preview' | 'saving';

export function AudioComposer({ onSend, onSendImage }: { onSend: (audio: Blob, durationSeconds?: number) => Promise<void>; onSendImage: (file: File, caption: string) => Promise<void> }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [draft, setDraft] = useState<AudioDraft | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const startedAt = useRef(0);
  const generation = useRef(0);
  const stopButton = useRef<HTMLButtonElement>(null);

  const releaseMicrophone = () => {
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
  };

  useEffect(() => () => {
    generation.current++;
    const active = recorder.current;
    if (active) {
      active.onstop = null;
      active.ondataavailable = null;
      active.onerror = null;
      if (active.state !== 'inactive') active.stop();
    }
    releaseMicrophone();
  }, []);

  useEffect(() => {
    if (!draft) { setPreviewUrl(''); return; }
    const url = URL.createObjectURL(draft.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft]);

  useEffect(() => {
    if (phase !== 'recording') return;
    stopButton.current?.focus();
    const timer = window.setInterval(() => {
      const elapsed = (Date.now() - startedAt.current) / 1000;
      setSeconds(elapsed);
      if (elapsed >= 60 && recorder.current?.state === 'recording') recorder.current.stop();
    }, 200);
    return () => window.clearInterval(timer);
  }, [phase]);

  function cancel() {
    generation.current++;
    const active = recorder.current;
    if (active) {
      active.onstop = null;
      active.ondataavailable = null;
      active.onerror = null;
      if (active.state !== 'inactive') active.stop();
    }
    releaseMicrophone();
    recorder.current = null;
    setDraft(null);
    setError('');
    setSeconds(0);
    setPhase('idle');
  }

  async function startRecording() {
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Para gravar áudio, abra o chat por localhost ou HTTPS.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') { setError('Este navegador não oferece gravação de áudio. Use um navegador compatível.'); return; }
    const requestGeneration = ++generation.current;
    setPhase('requesting');
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation.current !== requestGeneration) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      const active = preferred ? new MediaRecorder(media, { mimeType: preferred }) : new MediaRecorder(media);
      recorder.current = active;
      const chunks: Blob[] = [];
      active.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      active.onerror = () => {
        if (generation.current !== requestGeneration) return;
        cancel();
        setError('A gravação foi interrompida. Verifique o microfone e tente novamente.');
      };
      active.onstop = () => {
        releaseMicrophone();
        if (generation.current !== requestGeneration) return;
        try {
          const blob = prepareAudio(new Blob(chunks, { type: active.mimeType }));
          setDraft({ blob, durationSeconds: (Date.now() - startedAt.current) / 1000 });
          setPhase('preview');
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : 'Não foi possível concluir a gravação.');
          setPhase('idle');
        }
      };
      active.start();
      startedAt.current = Date.now();
      setSeconds(0);
      setPhase('recording');
    } catch (failure) {
      if (generation.current !== requestGeneration) return;
      releaseMicrophone();
      setPhase('idle');
      setError(failure instanceof DOMException && failure.name === 'NotAllowedError'
        ? 'Permita o acesso ao microfone para gravar.'
        : 'Não foi possível acessar o microfone. Verifique o dispositivo e tente novamente.');
    }
  }

  async function sendAudio() {
    if (!draft || phase === 'saving') return;
    setError('');
    setPhase('saving');
    try { await onSend(draft.blob, draft.durationSeconds); setDraft(null); setPhase('idle'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível enviar o áudio.'); setPhase('preview'); }
  }

  return <section className="audio-composer" aria-label="Enviar áudio ou imagem">
    {phase === 'idle' && <div className="audio-actions"><button type="button" onClick={() => void startRecording()}><Icon name="mic" size={17} />Gravar áudio</button><ImageComposer onSend={onSendImage} /></div>}
    {phase === 'requesting' && <div className="recording-bar"><span role="status">Aguardando o microfone…</span><button type="button" onClick={cancel}>Cancelar</button></div>}
    {phase === 'recording' && <div className="recording-bar"><span className="recording-dot" /><span>Gravando {formatDuration(seconds)} <small>/ 1:00</small></span><button type="button" className="recording-stop" ref={stopButton} onClick={() => { if (recorder.current?.state === 'recording') recorder.current.stop(); }}><Icon name="stop" size={15} />Concluir</button><button type="button" aria-label="Cancelar gravação" onClick={cancel}><Icon name="close" size={17} /></button></div>}
    {(phase === 'preview' || phase === 'saving') && <div className="audio-preview"><span>Ouça antes de enviar</span>{previewUrl && <audio controls src={previewUrl} aria-label="Ouvir áudio antes de enviar" />}<div><button type="button" onClick={cancel} disabled={phase === 'saving'}>Descartar</button><button type="button" className="audio-send" onClick={() => void sendAudio()} disabled={phase === 'saving'}><Icon name="send" size={16} />{phase === 'saving' ? 'Enviando…' : 'Enviar áudio'}</button></div></div>}
    {error && <p className="audio-composer__error" role="alert">{error}</p>}
  </section>;
}
