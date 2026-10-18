import type { EventoChat } from './tipos';

export interface Envio {
  sessaoId: string;
  texto?: string;
  origem?: 'texto' | 'audio';
  imagem?: Blob | null;
  acao?: 'confirmar_pedido';
}

/** Manda uma mensagem e repassa cada evento do stream assim que ele chega. */
export async function conversar(envio: Envio, aoEvento: (evento: EventoChat) => void): Promise<void> {
  const form = new FormData();
  form.append('sessao_id', envio.sessaoId);
  form.append('texto', envio.texto ?? '');
  form.append('origem', envio.origem ?? 'texto');
  if (envio.acao) form.append('acao', envio.acao);
  if (envio.imagem) form.append('imagem', envio.imagem, 'imagem.jpg');

  const resposta = await fetch('/api/chat', { method: 'POST', body: form });
  if (!resposta.ok || !resposta.body) {
    let detalhe = '';
    try {
      detalhe = (await resposta.json()).detail;
    } catch {
      /* corpo não é JSON */
    }
    throw new Error(detalhe || `O servidor respondeu ${resposta.status}. Confira se o backend está rodando.`);
  }

  const leitor = resposta.body.pipeThrough(new TextDecoderStream()).getReader();
  let resto = '';
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    resto += value;
    let fim: number;
    while ((fim = resto.indexOf('\n\n')) !== -1) {
      const bloco = resto.slice(0, fim);
      resto = resto.slice(fim + 2);
      const dados = bloco
        .split('\n')
        .filter((linha) => linha.startsWith('data:'))
        .map((linha) => linha.slice(5).trimStart())
        .join('\n');
      if (dados) aoEvento(JSON.parse(dados) as EventoChat);
    }
  }
}

export interface Saude {
  llm: string;
  modelo: string;
  mcp_conectados: string[];
  mcp_falhas: Record<string, string>;
  tools_mcp: number;
  skills: string[];
}

export async function lerSaude(): Promise<Saude | null> {
  try {
    const resposta = await fetch('/api/saude');
    return resposta.ok ? await resposta.json() : null;
  } catch {
    return null;
  }
}

export function apagarSessao(sessaoId: string): void {
  fetch(`/api/sessoes/${sessaoId}`, { method: 'DELETE' }).catch(() => {});
}
