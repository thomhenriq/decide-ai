import { Fragment, type ReactNode } from 'react';

const MARCADOR = /^\s*(?:[-*•]|\d+[.)])\s+/;

function negrito(texto: string): ReactNode[] {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((trecho, i) =>
    trecho.length > 4 && trecho.startsWith('**') && trecho.endsWith('**') ? (
      <strong key={i}>{trecho.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{trecho}</Fragment>
    ),
  );
}

/** Markdown mínimo do que o agente escreve: parágrafos, listas e **negrito**. */
export function Texto({ texto }: { texto: string }) {
  const blocos: { tipo: 'p' | 'ul'; linhas: string[] }[] = [];
  for (const linha of texto.trim().split('\n')) {
    if (!linha.trim()) {
      blocos.push({ tipo: 'p', linhas: [] });
      continue;
    }
    const item = MARCADOR.test(linha);
    const tipo = item ? 'ul' : 'p';
    const conteudo = item ? linha.replace(MARCADOR, '') : linha;
    const ultimo = blocos[blocos.length - 1];
    if (ultimo && ultimo.tipo === tipo && ultimo.linhas.length > 0) ultimo.linhas.push(conteudo);
    else blocos.push({ tipo, linhas: [conteudo] });
  }

  return (
    <>
      {blocos
        .filter((b) => b.linhas.length > 0)
        .map((bloco, b) =>
          bloco.tipo === 'ul' ? (
            <ul key={b}>
              {bloco.linhas.map((linha, i) => (
                <li key={i}>{negrito(linha)}</li>
              ))}
            </ul>
          ) : (
            <p key={b}>
              {bloco.linhas.map((linha, i) => (
                <Fragment key={i}>
                  {i > 0 && <br />}
                  {negrito(linha)}
                </Fragment>
              ))}
            </p>
          ),
        )}
    </>
  );
}
