import { useEffect, useRef, useState } from 'react';
import { apagarSessao, conversar, lerSaude, type Envio, type Saude } from './api';
import { Composer, type NovaMensagem } from './Composer';
import { Confirmacao } from './Confirmacao';
import { Opcoes } from './Opcoes';
import { Texto } from './Texto';
import type { EventoChat, Mensagem, Opcao } from './tipos';

const SUGESTOES = [
  'Tenho até R$ 60, quero comida vegana e preciso receber rápido',
  'Quero um x-bacon',
  'Algo leve pra jantar, sem demorar',
];

function aplicarEvento(m: Mensagem, ev: EventoChat): Mensagem {
  switch (ev.type) {
    case 'delta': {
      const ultima = m.partes[m.partes.length - 1];
      const partes =
        ultima?.tipo === 'texto'
          ? [...m.partes.slice(0, -1), { tipo: 'texto' as const, texto: ultima.texto + ev.texto }]
          : [...m.partes, { tipo: 'texto' as const, texto: ev.texto }];
      return { ...m, partes, status: undefined };
    }
    case 'status':
      return { ...m, status: ev.texto };
    case 'opcoes':
      return { ...m, partes: [...m.partes, { tipo: 'opcoes', opcoes: ev.opcoes, ativa: true }] };
    case 'confirmacao':
      return { ...m, partes: [...m.partes, { tipo: 'confirmacao', estado: 'aberta' }] };
    case 'erro':
      return { ...m, partes: [...m.partes, { tipo: 'erro', texto: ev.mensagem }] };
    case 'fim':
      return { ...m, trabalhando: false, status: undefined };
  }
}

/** Ao mandar algo novo, fichas e comandas antigas deixam de valer. */
function encerrarPendencias(mensagens: Mensagem[], confirmando: boolean): Mensagem[] {
  return mensagens.map((m) => ({
    ...m,
    partes: m.partes.map((p) => {
      if (p.tipo === 'opcoes' && p.ativa) return { ...p, ativa: false };
      if (p.tipo === 'confirmacao' && p.estado === 'aberta') return { ...p, estado: confirmando ? 'confirmada' : 'expirada' };
      return p;
    }),
  }));
}

function descreverAmbiente(saude: Saude | null): string {
  if (!saude) return 'Backend fora do ar: rode o uvicorn na porta 8000.';
  const conectados = saude.mcp_conectados.length ? saude.mcp_conectados.join(', ') : 'nenhum MCP';
  const falhas = Object.keys(saude.mcp_falhas);
  return (
    `Conectado a ${conectados} (${saude.tools_mcp} tools). Modelo: ${saude.modelo}.` +
    (falhas.length ? ` Sem conexão: ${falhas.join(', ')}.` : '') +
    ` Skills ativas: ${saude.skills.length}.`
  );
}

export default function App() {
  const [sessaoId, setSessaoId] = useState(() => crypto.randomUUID());
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [saude, setSaude] = useState<Saude | null | undefined>(undefined);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    lerSaude().then(setSaude);
  }, []);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [mensagens]);

  function atualizar(id: string, mudar: (m: Mensagem) => Mensagem) {
    setMensagens((atual) => atual.map((m) => (m.id === id ? mudar(m) : m)));
  }

  async function falarComAgente(envio: Omit<Envio, 'sessaoId'>, daPessoa: Mensagem) {
    if (ocupado) return;
    const idAgente = crypto.randomUUID();
    setOcupado(true);
    setMensagens((atual) => [
      ...encerrarPendencias(atual, envio.acao === 'confirmar_pedido'),
      daPessoa,
      { id: idAgente, autor: 'agente', partes: [], trabalhando: true },
    ]);
    try {
      await conversar({ ...envio, sessaoId }, (ev) => atualizar(idAgente, (m) => aplicarEvento(m, ev)));
    } catch (erro) {
      const texto = erro instanceof Error ? erro.message : 'Sem conexão com o backend.';
      atualizar(idAgente, (m) => ({ ...m, partes: [...m.partes, { tipo: 'erro', texto }] }));
    } finally {
      atualizar(idAgente, (m) => ({ ...m, trabalhando: false, status: undefined }));
      setOcupado(false);
    }
  }

  function enviar({ texto, imagem, origem }: NovaMensagem) {
    falarComAgente(
      { texto, imagem, origem },
      {
        id: crypto.randomUUID(),
        autor: 'pessoa',
        partes: texto ? [{ tipo: 'texto', texto }] : [],
        imagemUrl: imagem ? URL.createObjectURL(imagem) : undefined,
        viaAudio: origem === 'audio',
      },
    );
  }

  const escrever = (texto: string) => enviar({ texto, imagem: null, origem: 'texto' });
  const escolher = (o: Opcao) => escrever(`Quero essa: ${o.nome} (${o.restaurante})`);
  const recusar = (motivo: string) => escrever(`Nenhuma dessas: ${motivo.toLowerCase()}`);

  function confirmar() {
    falarComAgente(
      { acao: 'confirmar_pedido' },
      { id: crypto.randomUUID(), autor: 'pessoa', partes: [{ tipo: 'texto', texto: 'Confirmar pedido' }] },
    );
  }

  function novaConversa() {
    if (ocupado) return;
    apagarSessao(sessaoId);
    setSessaoId(crypto.randomUUID());
    setMensagens([]);
  }

  return (
    <div className="app">
      <header className="topo">
        <p className="marca">
          Decide<span aria-hidden="true">.</span>
        </p>
        {mensagens.length > 0 && (
          <button type="button" className="botao-texto" onClick={novaConversa} disabled={ocupado}>
            Nova conversa
          </button>
        )}
      </header>

      <main className="conversa" aria-live="polite">
        {mensagens.length === 0 ? (
          <section className="boas-vindas">
            <h1>Fome de quê?</h1>
            <p>
              Diga o que você quer, mande um áudio ou o print de uma comida que viu por aí. Eu acho no iFood e
              deixo o pedido pronto para você confirmar.
            </p>
            <div className="sugestoes">
              {SUGESTOES.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => escrever(s)}>
                  {s}
                </button>
              ))}
            </div>
            {saude !== undefined && <p className="ambiente">{descreverAmbiente(saude)}</p>}
          </section>
        ) : (
          <ol className="mensagens">
            {mensagens.map((m) => (
              <li key={m.id} className={`msg msg-${m.autor}`}>
                {m.imagemUrl && <img className="msg-imagem" src={m.imagemUrl} alt="Imagem enviada" />}
                {m.partes.map((p, i) => {
                  if (p.tipo === 'texto')
                    return (
                      <div key={i} className="balao">
                        <Texto texto={p.texto} />
                      </div>
                    );
                  if (p.tipo === 'opcoes')
                    return <Opcoes key={i} opcoes={p.opcoes} ativa={p.ativa && !ocupado} aoEscolher={escolher} aoRecusar={recusar} />;
                  if (p.tipo === 'confirmacao')
                    return (
                      <Confirmacao
                        key={i}
                        estado={p.estado}
                        aoConfirmar={confirmar}
                        aoAjustar={() => escrever('Quero ajustar o pedido antes de confirmar.')}
                      />
                    );
                  return (
                    <p key={i} className="msg-erro" role="alert">
                      {p.texto}
                    </p>
                  );
                })}
                {m.viaAudio && <p className="msg-rodape">Mensagem de voz</p>}
                {m.trabalhando && (
                  <p className="trabalhando">
                    {m.status ?? 'Pensando'}
                    <span className="pontos" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
        <div ref={fim} />
      </main>

      <Composer ocupado={ocupado} aoEnviar={enviar} />
    </div>
  );
}
