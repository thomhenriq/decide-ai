import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runClaude } from './agent.mjs';
import { gerarInsights, K_MINIMO, situacaoDosDados, validarTextoModelo } from './insights.mjs';

const MAX_BODY_BYTES = 256 * 1024;
const SKILL_PATH = new URL('./skills/gerar-insights.md', import.meta.url);
const EMOJI = { demanda_apos_fechamento: '🌙', lacuna_demanda: '🔎', tendencia: '📈' };

/** Carrega só as instruções do agente: sem o cabeçalho YAML e sem o anexo para o time. */
export function carregarSkill(path = SKILL_PATH) {
  const texto = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  return texto.replace(/^---\n[\s\S]*?\n---\n/, '').split('<!-- FIM DAS INSTRUÇÕES DO AGENTE')[0].trim();
}

const OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['pedido_de_insights', 'resposta', 'cards'],
  properties: {
    pedido_de_insights: { type: 'boolean' },
    resposta: { type: 'string' },
    cards: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['indice', 'titulo', 'texto', 'acao'],
        properties: { indice: { type: 'integer' }, titulo: { type: 'string' }, texto: { type: 'string' }, acao: { type: 'string' } },
      },
    },
  },
};

const diaMes = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

/** Aviso honesto quando nenhum padrão chegou ao volume mínimo. Todos os números vêm do banco. */
export function avisoSemDados(situacao, k = K_MINIMO) {
  const { buscas, concluidas, pedidos } = situacao;
  const pendentes = buscas - concluidas;
  const semConclusao = pendentes === 0 ? ''
    : pendentes === buscas ? (buscas === 1 ? ' Ela ainda não foi concluída, então não dá para tirar conclusões.' : ' Nenhuma delas foi concluída ainda, então não dá para tirar conclusões.')
    : pendentes === 1 ? ' A outra ainda não foi concluída.' : ' As outras ainda não foram concluídas.';
  const volume = buscas === 0
    ? 'Até agora não registrei nenhuma busca na região.'
    : `Até agora registrei ${plural(buscas, 'busca', 'buscas')} na região, e ${plural(concluidas, 'conversa chegou', 'conversas chegaram')} ao fim (${plural(pedidos, 'pedido confirmado', 'pedidos confirmados')}).${semConclusao}`;
  const linhas = [
    'Ainda não tenho dados concretos para te passar um insight confiável desta semana.',
    '',
    `${volume} Um insight só sai quando o mesmo padrão aparece pelo menos ${k} vezes.`,
  ];
  if (situacao.termos.length) {
    linhas.push('', `Primeiros sinais, ainda sem volume suficiente: ${situacao.termos.map(t => `${t.termo} (${plural(t.total, 'busca', 'buscas')})`).join(', ')}.`);
  }
  linhas.push('', 'Assim que houver mais conversas concluídas, te mando um resumo mais preciso. 😉');
  return linhas.join('\n');
}

export function montarResumo({ cards, situacao, fim, abertura }) {
  const inicio = new Date(fim.getTime() - situacao.dias * 86_400_000);
  const cabecalho = `📊 Insights da semana (${diaMes.format(inicio)} a ${diaMes.format(fim)})`;
  if (!cards.length) return `${cabecalho}\n\n${avisoSemDados(situacao)}`;
  const corpo = cards.map(c => `${EMOJI[c.tipo] ?? '•'} ${c.titulo}\n${c.texto}\n💡 ${c.acao}`).join('\n\n');
  const base = `Base: ${plural(situacao.buscas, 'busca', 'buscas')} na região, ${plural(situacao.concluidas, 'conversa concluída', 'conversas concluídas')}.`;
  // Há volume, mas a maioria das conversas não chegou ao fim: o padrão existe, a conclusão ainda é fraca.
  const ressalva = situacao.concluidas * 2 < situacao.buscas
    ? '⚠️ A maioria dessas conversas ainda não foi concluída, então trate esses números como um primeiro sinal, não como um dado fechado.'
    : null;
  return [cabecalho, ...(abertura ? [abertura] : []), corpo, base, ...(ressalva ? [ressalva] : [])].join('\n\n');
}

function readJson(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => { size += chunk.length; if (size <= MAX_BODY_BYTES) chunks.push(chunk); });
    request.on('end', () => {
      if (size > MAX_BODY_BYTES) return reject(Object.assign(new Error('A mensagem é grande demais.'), { status: 413 }));
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('Envie um JSON válido.'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function json(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

/**
 * Middleware Node do chat do restaurante. A cada mensagem, calcula os insights da semana no banco
 * e pede ao Claude (com a skill gerar-insights) para decidir se é um pedido de insight e reescrever os cards.
 */
export function createRestaurantAgentHandler({
  store,
  command = process.env.CLAUDE_COMMAND || 'claude',
  model = process.env.CLAUDE_MODEL || 'haiku',
  restaurant = {},
  run = runClaude,
  now = () => new Date(),
} = {}) {
  const skill = carregarSkill();
  const { name = 'Restaurante demo', closingHour, city } = restaurant;

  async function answer({ message, history = [] }) {
    store.expirarAbertos();
    store.apagarAntigos();
    const fim = now();
    const cards = gerarInsights(store.db, { fim, fechamento: closingHour, cidade: city });
    const situacao = situacaoDosDados(store.db, { fim, cidade: city });
    const contexto = {
      restaurante: { nome: name, ...(Number.isInteger(closingHour) ? { fecha_as: `${closingHour}h` } : {}) },
      cards: cards.map((c, indice) => ({ indice, tipo: c.tipo, metricas: c.metricas, contexto: c.contexto, titulo: c.titulo, texto: c.texto, acao: c.acao })),
    };
    const conversa = history.filter(item => item.id !== message.id).slice(-6)
      .map(item => `${item.role === 'user' ? 'Restaurante' : 'Decide Aí'}: ${item.content}`).join('\n');
    const prompt = `${conversa ? `Conversa até agora:\n${conversa}\n\n` : ''}Nova mensagem do restaurante:\n${message.content}\n\nDados calculados pelo backend (JSON):\n${JSON.stringify(contexto)}`;
    const args = [
      '-p', '--output-format', 'stream-json', '--verbose', '--model', model,
      '--permission-mode', 'dontAsk', '--no-session-persistence',
      // Sem ferramentas e sem MCP: o restaurante não consulta o iFood, só recebe o que o banco calculou.
      '--tools', '', '--strict-mcp-config',
      '--append-system-prompt', skill,
      '--json-schema', JSON.stringify(OUTPUT_SCHEMA),
    ];
    const result = await run({ command, args, prompt });
    if (result.is_error) throw Object.assign(new Error(result.result || 'O agente retornou um erro.'), { status: 502 });
    const output = result.structured_output ?? {};
    console.info('[restaurant:agent]', `${result.duration_ms} ms`, `insights: ${output.pedido_de_insights}`, `${cards.length} cards`);
    if (!output.pedido_de_insights) {
      return output.resposta?.trim() || 'Oi! Quando quiser, me peça os insights da semana que eu te mando um resumo da procura na sua região.';
    }
    const reescritos = new Map((output.cards ?? []).map(c => [c.indice, c]));
    const finais = cards.map((base, indice) => validarTextoModelo(base, reescritos.get(indice)));
    return montarResumo({ cards: finais, situacao, fim, abertura: output.resposta?.trim() });
  }

  return async (request, response) => {
    try {
      if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); return json(response, 405, { error: 'Use POST.' }); }
      const payload = await readJson(request);
      if (typeof payload?.message?.content !== 'string' || !payload.message.content.trim()) return json(response, 400, { error: 'Envie a mensagem do restaurante.' });
      const text = await answer(payload);
      json(response, 200, { type: 'text', text, messageId: `restaurant-${randomUUID()}` });
    } catch (error) {
      console.error('[restaurant:error]', error.message);
      json(response, error.status || 500, { error: error.message || 'Falha no agente do restaurante.' });
    }
  };
}
