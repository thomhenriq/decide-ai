import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Registro de eventos da Inteligência de Demanda (skill registrar-evento, sem a parte de feedback).
 *
 * Um EVENTO é um ciclo de busca: nasce quando o cliente diz o que quer e fecha quando ele confirma
 * o pedido (aceitou), troca de ideia (trocou), não encontra opção (sem_opcao) ou some (desistiu).
 *
 * Privacidade: nada liga o evento à conversa ou à pessoa. Não guardamos conversationId, endereço,
 * coordenadas, CPF, pagamento, fotos nem restrições de saúde. Região = bairro + cidade.
 * Eventos individuais são apagados após RETENCAO_DIAS.
 */
export const RETENCAO_DIAS = 30;
// Evento aberto sem atividade por mais que isso é considerado abandonado.
export const INATIVIDADE_MIN = 60;
export const RESULTADOS = ['aceitou', 'trocou', 'desistiu', 'sem_opcao'];
const DIAS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS eventos (
  evento_id TEXT PRIMARY KEY, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL,
  dia_semana TEXT, turno TEXT, hora INTEGER, bairro TEXT, cidade TEXT, canal TEXT, termo TEXT,
  orcamento_max_item REAL, prazo_max_min INTEGER, taxa_entrega_max REAL, dietas TEXT,
  resultado TEXT, merchant_escolhido TEXT
);
CREATE TABLE IF NOT EXISTS exibicoes (evento_id TEXT, merchant_id TEXT, item_id TEXT, posicao INTEGER);
CREATE INDEX IF NOT EXISTS eventos_criado_em ON eventos(criado_em);
`;

/** Mesmos limites de turno() da skill registrar-evento. */
export function turno(agora) {
  const h = agora.getHours();
  if (h >= 5 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 15 && h < 18) return 'snack';
  return 'dinner';
}

/** Data local em ISO sem fuso (AAAA-MM-DDTHH:MM), comparável como texto. */
export function isoLocal(data) {
  const pad = value => String(value).padStart(2, '0');
  return `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}T${pad(data.getHours())}:${pad(data.getMinutes())}`;
}

const texto = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : null;
const numero = value => Number.isFinite(value) && value >= 0 ? value : null;
const normalizarTermo = value => texto(value)?.toLocaleLowerCase('pt-BR') ?? null;

export function createEventStore({ path = resolve(process.cwd(), 'data', 'decide-ai.db'), now = () => new Date() } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  // conversationId -> evento aberto. Fica só na memória do servidor, nunca no banco.
  const abertos = new Map();

  const fechar = (eventoId, resultado, merchantId = null) => {
    db.prepare('UPDATE eventos SET resultado = ?, merchant_escolhido = ?, atualizado_em = ? WHERE evento_id = ? AND resultado IS NULL')
      .run(resultado, merchantId, isoLocal(now()), eventoId);
  };
  const tocar = eventoId => db.prepare('UPDATE eventos SET atualizado_em = ? WHERE evento_id = ?').run(isoLocal(now()), eventoId);

  return {
    db,

    /**
     * Registra o que o cliente quer. Mesmo termo: atualiza os filtros do evento aberto.
     * Termo novo: fecha o anterior (trocou, se já viu opções; senão desistiu) e abre outro.
     */
    registrarDesejo(conversationId, desejo, { canal = 'texto', regiao = {} } = {}) {
      const termo = normalizarTermo(desejo?.termo);
      if (!termo) return null;
      const aberto = abertos.get(conversationId);
      const filtros = [numero(desejo.orcamentoMaxItem), Number.isInteger(desejo.prazoMaxMin) ? numero(desejo.prazoMaxMin) : null,
        numero(desejo.taxaEntregaMax), Array.isArray(desejo.dietas) && desejo.dietas.length ? JSON.stringify(desejo.dietas.map(texto).filter(Boolean)) : null];
      if (aberto && aberto.termo === termo) {
        db.prepare(`UPDATE eventos SET orcamento_max_item = COALESCE(?, orcamento_max_item), prazo_max_min = COALESCE(?, prazo_max_min),
          taxa_entrega_max = COALESCE(?, taxa_entrega_max), dietas = COALESCE(?, dietas),
          bairro = COALESCE(bairro, ?), cidade = COALESCE(cidade, ?), atualizado_em = ? WHERE evento_id = ?`)
          .run(...filtros, texto(regiao.bairro), texto(regiao.cidade), isoLocal(now()), aberto.eventoId);
        return aberto.eventoId;
      }
      if (aberto) fechar(aberto.eventoId, aberto.exibiu ? 'trocou' : 'desistiu');
      const agora = now();
      const eventoId = randomUUID();
      db.prepare('INSERT INTO eventos VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)').run(
        eventoId, isoLocal(agora), isoLocal(agora), DIAS[agora.getDay()], turno(agora), agora.getHours(),
        texto(regiao.bairro), texto(regiao.cidade), canal, termo, ...filtros);
      abertos.set(conversationId, { eventoId, termo, exibiu: false });
      return eventoId;
    },

    /** Restaurantes e pratos mostrados ao cliente no evento aberto. */
    registrarExibicoes(conversationId, products = []) {
      const aberto = abertos.get(conversationId);
      if (!aberto || !products.length) return;
      const inserir = db.prepare('INSERT INTO exibicoes VALUES (?,?,?,?)');
      products.forEach((product, index) => inserir.run(aberto.eventoId, product.restaurant?.id ?? null, product.id ?? null, index + 1));
      aberto.exibiu = true;
      tocar(aberto.eventoId);
    },

    fecharEvento(conversationId, resultado, merchantId = null) {
      const aberto = abertos.get(conversationId);
      if (!aberto || !RESULTADOS.includes(resultado)) return;
      fechar(aberto.eventoId, resultado, merchantId);
      abertos.delete(conversationId);
    },

    /** Fecha como "desistiu" os eventos sem atividade há mais de INATIVIDADE_MIN. */
    expirarAbertos(minutos = INATIVIDADE_MIN) {
      const limite = isoLocal(new Date(now().getTime() - minutos * 60_000));
      const { changes } = db.prepare("UPDATE eventos SET resultado = 'desistiu' WHERE resultado IS NULL AND atualizado_em < ?").run(limite);
      for (const [conversationId, aberto] of abertos) {
        const linha = db.prepare('SELECT resultado FROM eventos WHERE evento_id = ?').get(aberto.eventoId);
        if (linha?.resultado) abertos.delete(conversationId);
      }
      return Number(changes);
    },

    /** Rodar periodicamente. Apaga eventos individuais antigos. */
    apagarAntigos(dias = RETENCAO_DIAS) {
      const limite = isoLocal(new Date(now().getTime() - dias * 86_400_000));
      db.prepare('DELETE FROM exibicoes WHERE evento_id IN (SELECT evento_id FROM eventos WHERE criado_em < ?)').run(limite);
      return Number(db.prepare('DELETE FROM eventos WHERE criado_em < ?').run(limite).changes);
    },

    close: () => db.close(),
  };
}
