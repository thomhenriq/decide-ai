import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createEventStore, isoLocal } from '../server/events.mjs';
import { demandaAposFechamento, gerarInsights, horasAposFechamento, K_MINIMO, lacunasDemanda, situacaoDosDados, tendencias, validarTextoModelo } from '../server/insights.mjs';
import { avisoSemDados, carregarSkill, createRestaurantAgentHandler } from '../server/restaurant-agent.mjs';

// Domingo, 18/10/2026, 23h.
const FIM = new Date(2026, 9, 18, 23, 0);
const REGIAO = { bairro: 'Cidade Universitária', cidade: 'Campinas' };

/** Banco em memória com o relógio controlado pelo teste. */
function store() {
  let agora = FIM;
  const events = createEventStore({ path: ':memory:', now: () => agora });
  let n = 0;
  const buscar = (termo, quando, { resultado, canal = 'texto', regiao = REGIAO, products } = {}) => {
    agora = quando;
    const conversa = `c${n++}`;
    events.registrarDesejo(conversa, { termo }, { canal, regiao });
    if (products) events.registrarExibicoes(conversa, products);
    if (resultado) events.fecharEvento(conversa, resultado);
    agora = FIM;
  };
  return { events, buscar };
}

const horas = (dias, hora, minuto = 0) => { const d = new Date(FIM); d.setDate(d.getDate() - dias); d.setHours(hora, minuto, 0, 0); return d; };

test('evento não guarda conversa, coordenadas nem endereço', () => {
  const { events } = store();
  events.registrarDesejo('conversa-secreta', { termo: 'Açaí', orcamentoMaxItem: 20, bairro: 'Rua X, 123' }, { regiao: REGIAO });
  const linha = events.db.prepare('SELECT * FROM eventos').get();
  assert.equal(linha.termo, 'açaí');
  assert.equal(linha.orcamento_max_item, 20);
  assert.equal(linha.hora, 23);
  assert.equal(linha.turno, 'dinner');
  assert.equal(linha.resultado, null);
  assert.ok(!JSON.stringify(linha).includes('conversa-secreta'));
  const colunas = events.db.prepare('PRAGMA table_info(eventos)').all().map(c => c.name);
  assert.ok(!colunas.some(c => /conversa|lat|lon|endereco|cpf/.test(c)));
});

test('mesmo termo atualiza o evento; termo novo fecha o anterior', () => {
  const { events } = store();
  events.registrarDesejo('c1', { termo: 'pizza' });
  events.registrarDesejo('c1', { termo: 'Pizza', prazoMaxMin: 30 });
  assert.equal(events.db.prepare('SELECT COUNT(*) AS n FROM eventos').get().n, 1);
  assert.equal(events.db.prepare('SELECT prazo_max_min AS p FROM eventos').get().p, 30);
  events.registrarExibicoes('c1', [{ id: 'i1', restaurant: { id: 'm1', name: 'X' } }]);
  events.registrarDesejo('c1', { termo: 'sushi' });
  const linhas = events.db.prepare('SELECT termo, resultado FROM eventos ORDER BY termo').all().map(l => [l.termo, l.resultado]);
  assert.deepEqual(linhas, [['pizza', 'trocou'], ['sushi', null]]);
  events.fecharEvento('c1', 'aceitou');
  assert.equal(events.db.prepare("SELECT resultado FROM eventos WHERE termo = 'sushi'").get().resultado, 'aceitou');
  assert.equal(events.db.prepare('SELECT COUNT(*) AS n FROM exibicoes').get().n, 1);
});

test('termo vazio não abre evento', () => {
  const { events } = store();
  assert.equal(events.registrarDesejo('c1', { termo: '  ' }), null);
  assert.equal(events.db.prepare('SELECT COUNT(*) AS n FROM eventos').get().n, 0);
});

test('eventos parados viram desistiu e antigos são apagados', () => {
  let agora = new Date(2026, 9, 18, 20, 0);
  const events = createEventStore({ path: ':memory:', now: () => agora });
  events.registrarDesejo('c1', { termo: 'pizza' });
  agora = new Date(2026, 9, 18, 22, 0);
  assert.equal(events.expirarAbertos(), 1);
  assert.equal(events.db.prepare('SELECT resultado FROM eventos').get().resultado, 'desistiu');
  agora = new Date(2026, 10, 30, 12, 0);
  assert.equal(events.apagarAntigos(), 1);
});

test('horas depois do fechamento vão até as 5h', () => {
  assert.deepEqual(horasAposFechamento(23), [23, 0, 1, 2, 3, 4]);
  assert.deepEqual(horasAposFechamento(2), [2, 3, 4]);
});

test('demanda de açaí depois que a loja fecha às 23h', () => {
  const { events, buscar } = store();
  for (let i = 0; i < 8; i++) buscar('açaí', horas(1 + (i % 5), 0, i), { resultado: 'desistiu' });       // 8 à meia-noite
  for (let i = 0; i < 4; i++) buscar('açaí', horas(2, 23, 30 + i), { resultado: 'aceitou' });             // 4 às 23h
  for (let i = 0; i < 9; i++) buscar('açaí', horas(3, 21, i));                                             // antes de fechar: não conta
  for (let i = 0; i < 3; i++) buscar('pizza', horas(1, 0, i));                                              // abaixo do mínimo
  const [card, ...resto] = demandaAposFechamento(events.db, { fim: FIM, fechamento: 23 });
  assert.equal(resto.length, 0);
  assert.deepEqual(card.metricas, { total: 12, dias: 7, fechamento: 23, pico: 0 });
  assert.equal(card.texto, '12 buscas por açaí na sua região depois das 23h nos últimos 7 dias, com mais procura por volta de meia-noite. Sua loja fecha às 23h.');
  assert.match(card.acao, /fechamento mais tarde/);
  assert.deepEqual(demandaAposFechamento(events.db, { fim: FIM }), [], 'sem horário de fechamento, não gera');
  assert.deepEqual(demandaAposFechamento(events.db, { fim: FIM, fechamento: 23, cidade: 'Limeira' }), []);
});

test('lacuna de demanda e tendência por foto respeitam o mínimo', () => {
  const { events, buscar } = store();
  for (let i = 0; i < K_MINIMO; i++) buscar('poke', horas(1, 20, i), { resultado: 'sem_opcao' });
  for (let i = 0; i < 3; i++) buscar('ramen', horas(1, 20, i), { resultado: 'sem_opcao' });
  for (let i = 0; i < K_MINIMO; i++) buscar('smash burger', horas(1, 19, i), { canal: 'imagem' });
  for (let i = 0; i < 2; i++) buscar('smash burger', horas(10, 19, i), { canal: 'imagem' });
  const lacunas = lacunasDemanda(events.db, { fim: FIM });
  assert.equal(lacunas.length, 1);
  assert.equal(lacunas[0].texto, '10 buscas por poke no bairro Cidade Universitária, no jantar, não encontraram opção nos últimos 7 dias.');
  const [tendencia] = tendencias(events.db, { fim: FIM });
  assert.deepEqual(tendencia.metricas, { atual: 10, anterior: 2 });
  assert.deepEqual(gerarInsights(events.db, { fim: FIM }).map(c => c.tipo), ['lacuna_demanda', 'tendencia']);
});

test('situação dos dados e aviso quando ainda não há volume', () => {
  const { events, buscar } = store();
  for (let i = 0; i < 4; i++) buscar('açaí', horas(1, 0, i), { resultado: i === 0 ? 'aceitou' : undefined });
  buscar('pizza', horas(1, 20, 0), { resultado: 'desistiu' });
  const situacao = situacaoDosDados(events.db, { fim: FIM });
  // A pizza abandonada (desistiu) e os açaís em andamento não contam como concluídos.
  assert.deepEqual(situacao, { buscas: 5, concluidas: 1, pedidos: 1, dias: 7, termos: [{ termo: 'açaí', total: 4 }, { termo: 'pizza', total: 1 }] });
  const aviso = avisoSemDados(situacao);
  assert.match(aviso, /Ainda não tenho dados concretos/);
  assert.match(aviso, /5 buscas na região, e 1 conversa chegou ao fim \(1 pedido confirmado\)/);
  assert.match(aviso, /As outras ainda não foram concluídas\./);
  assert.match(avisoSemDados({ ...situacao, buscas: 1, concluidas: 0, pedidos: 0, termos: [] }), /1 busca na região, e 0 conversas chegaram ao fim \(0 pedidos confirmados\)\. Ela ainda não foi concluída/);
  assert.match(avisoSemDados({ ...situacao, buscas: 0, concluidas: 0, pedidos: 0, termos: [] }), /não registrei nenhuma busca/);
  assert.match(aviso, /açaí \(4 buscas\), pizza \(1 busca\)/);
});

test('texto do modelo com número inventado é descartado', () => {
  const base = { tipo: 'demanda_apos_fechamento', metricas: { total: 12, dias: 7, fechamento: 23, pico: 0 }, titulo: 'T', texto: 'base', acao: 'a' };
  const bom = { titulo: 'Açaí procurado depois das 23h', texto: '12 buscas à meia-noite nos últimos 7 dias.', acao: 'Considere abrir até mais tarde.' };
  assert.equal(validarTextoModelo(base, bom).fonte, 'llm');
  assert.equal(validarTextoModelo(base, { ...bom, texto: 'Você perde R$ 300 por semana.' }).fonte, 'modelo_padrao');
  assert.equal(validarTextoModelo(base, { ...bom, texto: '30% das buscas.' }).texto, 'base');
  assert.equal(validarTextoModelo(base, undefined).fonte, 'modelo_padrao');
});

test('skill carregada sem cabeçalho nem anexo', () => {
  const skill = carregarSkill();
  assert.ok(skill.startsWith('# Atender o restaurante'));
  assert.ok(!skill.includes('name: gerar-insights') && !skill.includes('Origem:'));
});

async function pedir(handler, content) {
  const request = new PassThrough();
  request.method = 'POST';
  const response = { setHeader() {}, writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  request.end(JSON.stringify({ restaurantId: 'r', conversationId: 'x', message: { id: 'm', role: 'user', content }, history: [] }));
  await handler(request, response);
  return response;
}

test('restaurante pede insights sem dados suficientes: recebe o aviso', async () => {
  const { events, buscar } = store();
  buscar('açaí', horas(1, 0, 0));
  const handler = createRestaurantAgentHandler({ store: events, now: () => FIM, restaurant: { closingHour: 23 },
    run: async () => ({ structured_output: { pedido_de_insights: true, resposta: '', cards: [] } }) });
  const { status, body } = await pedir(handler, 'me manda os insights da semana');
  assert.equal(status, 200);
  assert.match(body.text, /^📊 Insights da semana \(11\/10 a 18\/10\)/);
  assert.match(body.text, /Ainda não tenho dados concretos/);
  assert.match(body.text, /1 busca na região, e 0 conversas chegaram ao fim/);
});

test('restaurante pede insights com dados: cards reescritos e validados', async () => {
  const { events, buscar } = store();
  for (let i = 0; i < 12; i++) buscar('açaí', horas(1 + (i % 5), 0, i), { resultado: 'desistiu' });
  let prompt;
  const handler = createRestaurantAgentHandler({ store: events, now: () => FIM, restaurant: { closingHour: 23 },
    run: async call => { prompt = call; return { structured_output: { pedido_de_insights: true, resposta: 'Olá! Segue o resumo:', cards: [
      { indice: 0, titulo: 'Açaí depois que você fecha', texto: 'Foram 12 buscas por açaí depois das 23h, a maioria à meia-noite.', acao: 'Considere testar fechar mais tarde.' },
    ] } }; } });
  const { body } = await pedir(handler, 'como foi a semana?');
  assert.match(body.text, /🌙 Açaí depois que você fecha\nForam 12 buscas por açaí depois das 23h, a maioria à meia-noite\.\n💡 Considere testar fechar mais tarde\./);
  // As 12 buscas foram abandonadas: há padrão, mas o aviso de dado ainda fraco aparece.
  assert.match(body.text, /Base: 12 buscas na região, 0 conversas concluídas\./);
  assert.match(body.text, /⚠️ A maioria dessas conversas ainda não foi concluída/);
  assert.ok(prompt.args.includes('--strict-mcp-config'), 'restaurante não acessa o MCP do iFood');
  assert.match(prompt.prompt, /"metricas":\{"total":12,"dias":7,"fechamento":23,"pico":0\}/);
});

test('mensagem comum do restaurante recebe a resposta do agente', async () => {
  const { events } = store();
  const handler = createRestaurantAgentHandler({ store: events, now: () => FIM,
    run: async () => ({ structured_output: { pedido_de_insights: false, resposta: 'Oi! Me peça os insights quando quiser.', cards: [] } }) });
  const { body } = await pedir(handler, 'bom dia');
  assert.equal(body.text, 'Oi! Me peça os insights quando quiser.');
});

test('isoLocal usa a hora local', () => {
  assert.equal(isoLocal(new Date(2026, 0, 2, 3, 4)), '2026-01-02T03:04');
});

test('seed gera os insights de açaí depois do fechamento e de poke sem opção', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const pasta = mkdtempSync(join(tmpdir(), 'seed-'));
  try {
    execFileSync(process.execPath, [resolve('scripts/seed-insights.mjs'), '--limpar'], { cwd: pasta, stdio: 'pipe' });
    const events = createEventStore({ path: join(pasta, 'data', 'decide-ai.db') });
    const cards = gerarInsights(events.db, { fim: new Date(), fechamento: 23 });
    assert.deepEqual(cards.map(c => c.tipo), ['demanda_apos_fechamento', 'lacuna_demanda']);
    assert.deepEqual(cards[0].metricas, { total: 16, dias: 7, fechamento: 23, pico: 0 });
    assert.equal(cards[1].metricas.total, 11);
    const situacao = situacaoDosDados(events.db, { fim: new Date() });
    assert.ok(situacao.concluidas * 2 >= situacao.buscas, 'a maioria das conversas do seed termina');
    events.close();
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});
