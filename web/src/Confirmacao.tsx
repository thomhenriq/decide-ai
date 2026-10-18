interface Props {
  estado: 'aberta' | 'confirmada' | 'expirada';
  aoConfirmar: () => void;
  aoAjustar: () => void;
}

/** A comanda: o pedido só sai pelo botão daqui (o backend segura o submitOrder até este toque). */
export function Confirmacao({ estado, aoConfirmar, aoAjustar }: Props) {
  return (
    <section className={`comanda comanda-${estado}`} aria-label="Confirmação do pedido">
      <h3 className="comanda-titulo">Tudo certo com o resumo?</h3>
      {estado === 'aberta' && (
        <>
          <p className="comanda-texto">O pedido só vai para o restaurante quando você confirmar.</p>
          <div className="comanda-acoes">
            <button type="button" className="botao botao-primario" onClick={aoConfirmar}>
              Confirmar pedido
            </button>
            <button type="button" className="botao botao-secundario" onClick={aoAjustar}>
              Quero ajustar
            </button>
          </div>
        </>
      )}
      {estado === 'confirmada' && <p className="comanda-carimbo">Confirmado</p>}
      {estado === 'expirada' && <p className="comanda-texto">Este resumo mudou. Peça um novo para confirmar.</p>}
    </section>
  );
}
