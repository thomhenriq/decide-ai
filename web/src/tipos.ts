export type Papel = 'mais_parecida' | 'mais_barata' | 'mais_rapida' | 'outra';

export interface Opcao {
  papel?: Papel;
  item_id?: string;
  merchant_id?: string;
  nome: string;
  restaurante: string;
  preco: number;
  taxa_entrega?: number;
  eta_min?: number;
  foto_url?: string;
  nota_semelhanca?: number;
  observacao?: string;
}

/** Eventos que o backend manda pelo stream (SSE). */
export type EventoChat =
  | { type: 'delta'; texto: string }
  | { type: 'status'; texto: string; ferramenta: string }
  | { type: 'opcoes'; opcoes: Opcao[] }
  | { type: 'confirmacao' }
  | { type: 'erro'; mensagem: string }
  | { type: 'fim' };

export type Parte =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'opcoes'; opcoes: Opcao[]; ativa: boolean }
  | { tipo: 'confirmacao'; estado: 'aberta' | 'confirmada' | 'expirada' }
  | { tipo: 'erro'; texto: string };

export interface Mensagem {
  id: string;
  autor: 'pessoa' | 'agente';
  partes: Parte[];
  imagemUrl?: string;
  viaAudio?: boolean;
  status?: string;
  trabalhando?: boolean;
}
