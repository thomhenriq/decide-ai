import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { prepararImagem, useDitado } from './midia';

export interface NovaMensagem {
  texto: string;
  imagem: Blob | null;
  origem: 'texto' | 'audio';
}

interface Props {
  ocupado: boolean;
  aoEnviar: (mensagem: NovaMensagem) => void;
}

export function Composer({ ocupado, aoEnviar }: Props) {
  const [texto, setTexto] = useState('');
  const [imagem, setImagem] = useState<Blob | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  const campo = useRef<HTMLTextAreaElement>(null);
  const seletor = useRef<HTMLInputElement>(null);

  function enviar(conteudo: string, origem: 'texto' | 'audio') {
    const limpo = conteudo.trim();
    if (ocupado || (!limpo && !imagem)) return;
    aoEnviar({ texto: limpo, imagem, origem });
    setTexto('');
    setImagem(null);
    setPrevia(null);
    setAviso('');
  }

  const ditado = useDitado((falado) => enviar(falado, 'audio'));

  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [texto, ditado.parcial]);

  async function anexar(arquivo: File | undefined) {
    if (!arquivo) return;
    if (!arquivo.type.startsWith('image/')) {
      setAviso('Envie uma imagem: foto ou print.');
      return;
    }
    try {
      const reduzida = await prepararImagem(arquivo);
      setImagem(reduzida);
      setPrevia(URL.createObjectURL(reduzida));
      setAviso('');
      campo.current?.focus();
    } catch {
      setAviso('Não deu para abrir essa imagem. Tente outra.');
    }
  }

  function aoTeclar(evento: KeyboardEvent<HTMLTextAreaElement>) {
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault();
      enviar(texto, 'texto');
    }
  }

  function aoColar(evento: ClipboardEvent<HTMLTextAreaElement>) {
    const arquivo = Array.from(evento.clipboardData.files).find((f) => f.type.startsWith('image/'));
    if (arquivo) {
      evento.preventDefault();
      anexar(arquivo);
    }
  }

  function aoSoltar(evento: DragEvent<HTMLFormElement>) {
    evento.preventDefault();
    anexar(evento.dataTransfer.files[0]);
  }

  const mensagemAviso = aviso || ditado.erro;

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        enviar(texto, 'texto');
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={aoSoltar}
    >
      {previa && (
        <div className="composer-previa">
          <img src={previa} alt="Imagem que vai junto com a mensagem" />
          <button
            type="button"
            className="botao-icone botao-remover"
            aria-label="Tirar a imagem"
            onClick={() => {
              setImagem(null);
              setPrevia(null);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      )}
      {mensagemAviso && (
        <p className="composer-aviso" role="alert">
          {mensagemAviso}
        </p>
      )}

      <div className="composer-linha">
        <input
          ref={seletor}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            anexar(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="botao-icone"
          aria-label="Mandar foto ou print"
          title="Mandar foto ou print"
          onClick={() => seletor.current?.click()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
        </button>

        <label className="visualmente-oculto" htmlFor="campo-mensagem">
          Mensagem
        </label>
        <textarea
          id="campo-mensagem"
          ref={campo}
          rows={1}
          value={ditado.ouvindo ? ditado.parcial : texto}
          readOnly={ditado.ouvindo}
          placeholder={ditado.ouvindo ? 'Pode falar…' : imagem ? 'Quer algo parecido? Diga o limite de preço' : 'O que você quer comer?'}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={aoTeclar}
          onPaste={aoColar}
        />

        {ditado.suportado && !texto.trim() && !imagem ? (
          <button
            type="button"
            className={`botao-icone botao-redondo${ditado.ouvindo ? ' ouvindo' : ''}`}
            aria-label={ditado.ouvindo ? 'Parar e enviar o áudio' : 'Falar o pedido'}
            aria-pressed={ditado.ouvindo}
            disabled={ocupado}
            onClick={ditado.ouvindo ? ditado.parar : ditado.iniciar}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
            </svg>
          </button>
        ) : (
          <button type="submit" className="botao-icone botao-redondo" aria-label="Enviar" disabled={ocupado}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </button>
        )}
      </div>
    </form>
  );
}
