import { useEffect, useState } from 'react';
import type { Message } from '../types';
import { loadAudio } from '../services/audioStorage';
import { formatDuration } from '../services/audio';
import { Icon } from './Icon';

export function AudioMessage({ message, onRetry }: { message: Message; onRetry: (id: string) => void }) {
  const [url, setUrl] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const audio = message.audio!;

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setUrl('');
    setUnavailable(false);
    loadAudio(audio.id).then(blob => {
      if (!active) return;
      if (!blob) { setUnavailable(true); return; }
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (active) setUnavailable(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [audio.id]);

  return <div className="audio-message">
    <div className="audio-message__label"><Icon name="mic" size={15} /><span>Mensagem de voz</span>{audio.durationSeconds !== undefined && <span>{formatDuration(audio.durationSeconds)}</span>}</div>
    {url && <audio controls preload="metadata" src={url} aria-label="Ouvir mensagem de voz" />}
    {unavailable && <span className="audio-message__status">O áudio não está mais disponível neste navegador.</span>}
    {audio.transcriptionStatus === 'pending' && <span className="audio-message__status" role="status">Transcrevendo áudio…</span>}
    {audio.transcriptionStatus === 'completed' && <span className="audio-message__status">Áudio transcrito</span>}
    {audio.transcriptionStatus === 'error' && <div className="audio-message__error"><span>{audio.transcriptionError || 'Não foi possível transcrever.'}</span><button type="button" onClick={() => onRetry(message.id)}>Tentar transcrição novamente</button></div>}
  </div>;
}
