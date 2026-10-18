import { useCallback, useEffect, useRef, useState } from 'react';

/** Reduz a foto/print para no máximo 1280 px e JPEG: upload leve e dentro do limite do Bedrock. */
export async function prepararImagem(arquivo: Blob, ladoMax = 1280): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, ladoMax / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; // prints com fundo transparente
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((ok, falha) =>
    canvas.toBlob((blob) => (blob ? ok(blob) : falha(new Error('imagem ilegível'))), 'image/jpeg', 0.85),
  );
}

// Web Speech API: transcreve no próprio navegador (Chrome e Edge). O texto vai para o agente marcado como áudio.
interface ResultadoFala {
  isFinal: boolean;
  0: { transcript: string };
}
interface EventoFala {
  results: ArrayLike<ResultadoFala>;
}
interface Reconhecedor {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((evento: EventoFala) => void) | null;
  onend: (() => void) | null;
  onerror: ((evento: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type ConstrutorReconhecedor = new () => Reconhecedor;

function construtor(): ConstrutorReconhecedor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: ConstrutorReconhecedor;
    webkitSpeechRecognition?: ConstrutorReconhecedor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function useDitado(aoTerminar: (texto: string) => void) {
  const [ouvindo, setOuvindo] = useState(false);
  const [parcial, setParcial] = useState('');
  const [erro, setErro] = useState('');
  const reconhecedor = useRef<Reconhecedor | null>(null);
  const textoFalado = useRef('');
  const callback = useRef(aoTerminar);

  useEffect(() => {
    callback.current = aoTerminar;
  }, [aoTerminar]);

  const iniciar = useCallback(() => {
    const Construtor = construtor();
    if (!Construtor || reconhecedor.current) return;
    const r = new Construtor();
    r.lang = 'pt-BR';
    r.interimResults = true;
    r.continuous = false;
    textoFalado.current = '';
    setErro('');
    r.onresult = (evento) => {
      let texto = '';
      for (let i = 0; i < evento.results.length; i++) texto += evento.results[i][0].transcript;
      textoFalado.current = texto;
      setParcial(texto);
    };
    r.onerror = (evento) => {
      if (evento.error === 'not-allowed') setErro('Libere o microfone no navegador para mandar áudio.');
      else if (evento.error !== 'no-speech' && evento.error !== 'aborted') setErro('Não entendi o áudio. Tente de novo.');
    };
    r.onend = () => {
      reconhecedor.current = null;
      setOuvindo(false);
      setParcial('');
      const texto = textoFalado.current.trim();
      if (texto) callback.current(texto);
    };
    reconhecedor.current = r;
    r.start();
    setOuvindo(true);
  }, []);

  const parar = useCallback(() => reconhecedor.current?.stop(), []);

  return { suportado: Boolean(construtor()), ouvindo, parcial, erro, iniciar, parar };
}
