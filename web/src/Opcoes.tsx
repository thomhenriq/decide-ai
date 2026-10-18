import { useState } from 'react';
import type { Opcao } from './tipos';

const PAPEIS: Record<string, string> = {
  mais_parecida: 'Mais parecida',
  mais_barata: 'Mais barata',
  mais_rapida: 'Chega mais rápido',
  outra: 'Outra opção',
};

const MOTIVOS = ['Muito caro', 'Taxa de entrega alta', 'Demora demais', 'Não parece com o que eu quero', 'Outro motivo'];

export const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  opcoes: Opcao[];
  ativa: boolean;
  aoEscolher: (opcao: Opcao) => void;
  aoRecusar: (motivo: string) => void;
}

export function Opcoes({ opcoes, ativa, aoEscolher, aoRecusar }: Props) {
  const [recusando, setRecusando] = useState(false);

  return (
    <div className="opcoes">
      <ul className="opcoes-trilho">
        {opcoes.map((o, i) => (
          <li key={o.item_id ?? i} className="ficha">
            <div className="ficha-foto">
              {o.foto_url ? (
                <img src={o.foto_url} alt={o.nome} loading="lazy" />
              ) : (
                <span aria-hidden="true">{o.nome.charAt(0)}</span>
              )}
            </div>
            {o.papel && <p className="ficha-papel">{PAPEIS[o.papel] ?? o.papel}</p>}
            <h3 className="ficha-nome">{o.nome}</h3>
            <p className="ficha-loja">{o.restaurante}</p>
            {o.observacao && <p className="ficha-obs">{o.observacao}</p>}
            <dl className="ficha-dados">
              <div>
                <dt>Preço</dt>
                <dd className="ficha-preco">{reais.format(o.preco)}</dd>
              </div>
              {o.eta_min != null && (
                <div>
                  <dt>Chega em</dt>
                  <dd>{o.eta_min} min</dd>
                </div>
              )}
              {o.taxa_entrega != null && (
                <div>
                  <dt>Entrega</dt>
                  <dd>{o.taxa_entrega === 0 ? 'Grátis' : reais.format(o.taxa_entrega)}</dd>
                </div>
              )}
            </dl>
            {o.nota_semelhanca != null && (
              <p className="ficha-nota">{Math.round(o.nota_semelhanca)}% parecido com o que você pediu</p>
            )}
            <button type="button" className="botao botao-primario" disabled={!ativa} onClick={() => aoEscolher(o)}>
              Quero essa
            </button>
          </li>
        ))}
      </ul>

      {ativa &&
        (recusando ? (
          <div className="motivos" role="group" aria-label="Por que nenhuma serve?">
            <p>O que pesou?</p>
            {MOTIVOS.map((motivo) => (
              <button key={motivo} type="button" className="chip" onClick={() => aoRecusar(motivo)}>
                {motivo}
              </button>
            ))}
          </div>
        ) : (
          <button type="button" className="botao-texto" onClick={() => setRecusando(true)}>
            Nenhuma dessas
          </button>
        ))}
    </div>
  );
}
