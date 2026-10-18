/**
 * Popula data/decide-ai.db com uma semana de buscas FICTÍCIAS para a demo dos insights.
 *
 *   npm run seed:insights              acrescenta o cenário ao banco
 *   npm run seed:insights -- --limpar  apaga todos os eventos antes (inclusive os reais)
 *
 * Cenário (últimos 6 dias, Cidade Universitária, Campinas):
 *   - 16 buscas por açaí entre 23h e 2h, a maioria à meia-noite: gera o insight de procura depois que a loja fecha às 23h;
 *   - 8 buscas por açaí à tarde: não contam para esse insight, a loja está aberta;
 *   - 11 buscas por poke sem nenhuma opção no jantar: gera o insight de lacuna de demanda;
 *   - 6 buscas por pizza: volume abaixo do mínimo, não gera insight.
 */
import { resolve } from 'node:path';
import { createEventStore } from '../server/events.mjs';

const REGIAO = { bairro: 'Cidade Universitária', cidade: 'Campinas' };
const limpar = process.argv.includes('--limpar');

let agora = new Date();
const store = createEventStore({ path: resolve(process.cwd(), 'data', 'decide-ai.db'), now: () => agora });
if (limpar) store.db.exec('DELETE FROM exibicoes; DELETE FROM eventos;');

const hoje = new Date();
let contador = 0;
/** Uma busca completa: abre o evento, mostra opções (se houver) e fecha com o resultado. */
function busca(termo, { diasAtras, hora, minuto = 0, resultado, opcoes = 3 }) {
  const quando = new Date(hoje);
  quando.setDate(quando.getDate() - diasAtras);
  quando.setHours(hora, minuto, 0, 0);
  agora = quando;
  const conversa = `seed-${contador++}`;
  store.registrarDesejo(conversa, { termo }, { canal: 'texto', regiao: REGIAO });
  if (resultado !== 'sem_opcao') {
    store.registrarExibicoes(conversa, Array.from({ length: opcoes }, (_, i) => ({ id: `seed-item-${i}`, restaurant: { id: `seed-loja-${i}` } })));
  }
  agora = new Date(quando.getTime() + 8 * 60_000);
  store.fecharEvento(conversa, resultado);
}

// Açaí depois das 23h: pico à meia-noite. A maioria das conversas termina (pedido ou sem opção).
const noite = [
  [1, 0, 'aceitou'], [1, 0, 'aceitou'], [1, 23, 'aceitou'], [2, 0, 'aceitou'], [2, 1, 'sem_opcao'],
  [3, 0, 'aceitou'], [3, 0, 'desistiu'], [3, 23, 'aceitou'], [4, 0, 'aceitou'], [4, 1, 'aceitou'],
  [5, 0, 'sem_opcao'], [5, 0, 'aceitou'], [5, 2, 'desistiu'], [6, 23, 'aceitou'], [6, 0, 'sem_opcao'], [6, 1, 'aceitou'],
];
noite.forEach(([diasAtras, hora, resultado], i) => busca('açaí', { diasAtras, hora, minuto: 5 + i * 3, resultado }));

for (let i = 0; i < 8; i++) busca('açaí', { diasAtras: 1 + (i % 6), hora: 15 + (i % 4), minuto: i * 7, resultado: 'aceitou' });
for (let i = 0; i < 11; i++) busca('poke', { diasAtras: 1 + (i % 6), hora: 19 + (i % 3), minuto: i * 4, resultado: 'sem_opcao' });
for (let i = 0; i < 6; i++) busca('pizza', { diasAtras: 1 + (i % 6), hora: 20, minuto: i * 9, resultado: i % 2 ? 'aceitou' : 'trocou' });

const total = store.db.prepare('SELECT COUNT(*) AS n FROM eventos').get().n;
console.log(`${contador} buscas fictícias registradas${limpar ? ' (banco limpo antes)' : ''}. Total no banco: ${total} eventos.`);
console.log('No chat "Restaurante", peça: "me manda os insights da semana". Requer RESTAURANT_CLOSING_HOUR=23 no .env.');
store.close();
