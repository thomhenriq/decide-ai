import { isoLocal } from './events.mjs';

/**
 * Cálculo dos insights para restaurantes (skill gerar-insights).
 * Os NÚMEROS saem daqui, em SQL. O modelo só reescreve o texto, e validarTextoModelo()
 * descarta qualquer versão que traga um número fora das métricas.
 * Nenhum insight sai com menos de K_MINIMO ocorrências.
 */
export const K_MINIMO = 10;
const TURNO_PT = { breakfast: 'café da manhã', lunch: 'almoço', snack: 'lanche da tarde', dinner: 'jantar' };
// Madrugada vai até as 5h, mesmo limite do turno "dinner".
const FIM_DA_NOITE = 5;

const periodo = (fim, dias) => [isoLocal(new Date(fim.getTime() - dias * 86_400_000)), isoLocal(fim)];
const filtroCidade = cidade => cidade ? ['AND cidade = ?', [cidade]] : ['', []];
export const formatarHora = hora => hora === 0 ? 'meia-noite' : `${hora}h`;

/** Horas entre o fechamento e o fim da madrugada. Fechando às 23h: 23, 0, 1, 2, 3 e 4. */
export function horasAposFechamento(fechamento) {
  const horas = [];
  for (let hora = fechamento; hora !== FIM_DA_NOITE; hora = (hora + 1) % 24) horas.push(hora);
  return horas;
}

const MODELOS = {
  demanda_apos_fechamento: [
    'Procura por {termo} depois que você fecha',
    '{total} buscas por {termo} na sua região depois das {fechamento_txt} nos últimos {dias} dias, com mais procura por volta de {pico_txt}. Sua loja fecha às {fechamento_txt}.',
    'Considere testar um horário de fechamento mais tarde nos dias de maior procura.',
  ],
  lacuna_demanda: [
    'Procura por {termo} sem resposta',
    '{total} buscas por {termo}{bairro_txt}, no {turno}, não encontraram opção nos últimos {dias} dias.',
    'Se fizer sentido para sua cozinha, considere incluir {termo} no cardápio.',
  ],
  tendencia: [
    '{termo} em alta na região',
    'Fotos de {termo} enviadas por clientes{cidade_txt} passaram de {anterior} para {atual} nesta semana.',
    'Se tiver algo parecido, vale destacar no cardápio.',
  ],
};

export function card(tipo, metricas, contexto) {
  const campos = { ...metricas, ...contexto };
  const preencher = modelo => modelo.replace(/\{(\w+)\}/g, (_, chave) => campos[chave] ?? '');
  const [titulo, texto, acao] = MODELOS[tipo].map(preencher);
  return { tipo, metricas, contexto, titulo: titulo[0].toUpperCase() + titulo.slice(1), texto, acao };
}

/** Buscas por um termo na região nas horas em que o restaurante já fechou. */
export function demandaAposFechamento(db, { fim, dias = 7, k = K_MINIMO, fechamento, cidade }) {
  if (!Number.isInteger(fechamento)) return [];
  const [ini, fimTxt] = periodo(fim, dias);
  const horas = horasAposFechamento(fechamento);
  const [sqlCidade, argsCidade] = filtroCidade(cidade);
  const linhas = db.prepare(`SELECT termo, COUNT(*) AS total FROM eventos
    WHERE termo IS NOT NULL AND criado_em BETWEEN ? AND ? AND hora IN (${horas.map(() => '?').join(',')}) ${sqlCidade}
    GROUP BY termo HAVING COUNT(*) >= ? ORDER BY total DESC`).all(ini, fimTxt, ...horas, ...argsCidade, k);
  return linhas.map(({ termo, total }) => {
    const { hora: pico } = db.prepare(`SELECT hora, COUNT(*) AS n FROM eventos
      WHERE termo = ? AND criado_em BETWEEN ? AND ? AND hora IN (${horas.map(() => '?').join(',')}) ${sqlCidade}
      GROUP BY hora ORDER BY n DESC, hora LIMIT 1`).get(termo, ini, fimTxt, ...horas, ...argsCidade);
    return card('demanda_apos_fechamento', { total: Number(total), dias, fechamento, pico },
      { termo, fechamento_txt: formatarHora(fechamento), pico_txt: formatarHora(pico) });
  });
}

/** Muita gente buscou algo e não encontrou opção. */
export function lacunasDemanda(db, { fim, dias = 7, k = K_MINIMO, cidade }) {
  const [ini, fimTxt] = periodo(fim, dias);
  const [sqlCidade, argsCidade] = filtroCidade(cidade);
  return db.prepare(`SELECT bairro, turno, termo, COUNT(*) AS total FROM eventos
    WHERE resultado = 'sem_opcao' AND termo IS NOT NULL AND criado_em BETWEEN ? AND ? ${sqlCidade}
    GROUP BY bairro, turno, termo HAVING COUNT(*) >= ? ORDER BY total DESC`).all(ini, fimTxt, ...argsCidade, k)
    .map(({ bairro, turno, termo, total }) => card('lacuna_demanda', { total: Number(total), dias },
      { termo, turno: TURNO_PT[turno] ?? turno, bairro_txt: bairro ? ` no bairro ${bairro}` : '' }));
}

/** Pratos que mais que dobraram em buscas por FOTO nesta semana. */
export function tendencias(db, { fim, k = K_MINIMO, cidade }) {
  const [atualIni, atualFim] = periodo(fim, 7);
  const [anteriorIni] = periodo(fim, 14);
  const [sqlCidade, argsCidade] = filtroCidade(cidade);
  return db.prepare(`SELECT termo, SUM(CASE WHEN criado_em >= ? THEN 1 ELSE 0 END) AS atual,
      SUM(CASE WHEN criado_em < ? THEN 1 ELSE 0 END) AS anterior
    FROM eventos WHERE canal = 'imagem' AND termo IS NOT NULL AND criado_em BETWEEN ? AND ? ${sqlCidade} GROUP BY termo`)
    .all(atualIni, atualIni, anteriorIni, atualFim, ...argsCidade)
    .filter(({ atual, anterior }) => atual >= k && atual >= 2 * Math.max(anterior, 1))
    .map(({ termo, atual, anterior }) => card('tendencia', { atual: Number(atual), anterior: Number(anterior) },
      { termo, cidade_txt: cidade ? ` de ${cidade}` : '' }));
}

/**
 * Volume da semana. Usado para avisar quando ainda não há dados suficientes.
 * Concluída = a conversa chegou a um desfecho: pedido confirmado ou busca sem opção.
 * Abandonadas, trocas de ideia e conversas em andamento não contam como concluídas.
 */
export function situacaoDosDados(db, { fim, dias = 7, cidade }) {
  const [ini, fimTxt] = periodo(fim, dias);
  const [sqlCidade, argsCidade] = filtroCidade(cidade);
  const contar = extra => Number(db.prepare(`SELECT COUNT(*) AS n FROM eventos WHERE criado_em BETWEEN ? AND ? ${sqlCidade} ${extra}`)
    .get(ini, fimTxt, ...argsCidade).n);
  const termos = db.prepare(`SELECT termo, COUNT(*) AS total FROM eventos WHERE termo IS NOT NULL AND criado_em BETWEEN ? AND ? ${sqlCidade}
    GROUP BY termo ORDER BY total DESC, termo LIMIT 3`).all(ini, fimTxt, ...argsCidade).map(linha => ({ termo: linha.termo, total: Number(linha.total) }));
  return { buscas: contar(''), concluidas: contar("AND resultado IN ('aceitou', 'sem_opcao')"), pedidos: contar("AND resultado = 'aceitou'"), termos, dias };
}

export function gerarInsights(db, { fim = new Date(), fechamento, cidade, k = K_MINIMO } = {}) {
  return [
    ...demandaAposFechamento(db, { fim, k, fechamento, cidade }),
    ...lacunasDemanda(db, { fim, k, cidade }),
    ...tendencias(db, { fim, k, cidade }),
  ];
}

const numeros = texto => new Set((String(texto).match(/\d+(?:[.,]\d+)?/g) ?? []).map(n => String(Number(n.replace(',', '.')))));

/** Aceita o texto do modelo só se ele não trouxer números fora das métricas. */
export function validarTextoModelo(base, saida) {
  const permitidos = numeros(Object.values(base.metricas).join(' '));
  const campos = ['titulo', 'texto', 'acao'];
  const completos = campos.every(campo => typeof saida?.[campo] === 'string' && saida[campo].trim());
  const escritos = completos ? numeros(campos.map(campo => saida[campo]).join(' ')) : new Set(['x']);
  if (![...escritos].every(n => permitidos.has(n))) return { ...base, fonte: 'modelo_padrao' };
  return { ...base, titulo: saida.titulo.trim(), texto: saida.texto.trim(), acao: saida.acao.trim(), fonte: 'llm' };
}
