import type { ProductRecommendation } from '../types';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const rating = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Texto comum, pronto para usar como legenda de uma foto. Sem layout ou botões HTML.
 * Com `choice`, a legenda começa com "Escolha N" para o cliente responder pelo número.
 */
export function formatProductCaption(product: ProductRecommendation, choice?: number): string {
  const min = product.delivery?.minMinutes;
  const max = product.delivery?.maxMinutes;
  const fee = product.delivery?.feeCents;
  const time = min !== undefined && max !== undefined ? min === max ? `${min} min` : `${min}–${max} min`
    : max !== undefined ? `Até ${max} min` : min !== undefined ? `A partir de ${min} min` : 'Prazo a consultar';
  const details = [
    `Restaurante: ${product.restaurant.name}`,
    product.restaurant.rating !== undefined
      ? `Avaliação: ⭐ ${rating.format(product.restaurant.rating)}${product.restaurant.ratingCount !== undefined ? ` (${product.restaurant.ratingCount} avaliações)` : ''}`
      : 'Nota não informada',
    product.priceCents === undefined ? 'Preço não informado' : `Preço: ${money.format(product.priceCents / 100)}`,
    ...(product.priceCents !== undefined && product.originalPriceCents !== undefined && product.originalPriceCents > product.priceCents
      ? [`Preço anterior: ${money.format(product.originalPriceCents / 100)}`] : []),
    `Entrega: ${time}`,
    fee === undefined ? 'Frete a consultar' : fee === 0 ? 'Entrega grátis' : `Frete: ${money.format(fee / 100)}`,
  ];
  // Orçamento conservador para legenda; o link segue em uma mensagem de texto separada.
  const title = choice === undefined ? product.name : `Escolha ${choice}\n${product.name}`;
  const room = Math.max(0, 900 - [title, ...details].join('\n').length - 1);
  const description = product.description && room > 0 ? product.description.length > room
    ? `${product.description.slice(0, Math.max(0, room - 1))}…` : product.description : '';
  return [title, ...(description ? [description] : []), ...details].join('\n');
}

export function splitMessageText(text: string): string[] {
  const result: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 4000) {
    let end = Math.max(remaining.lastIndexOf('\n', 4000), remaining.lastIndexOf(' ', 4000));
    if (end < 2000) end = 4000;
    // Preserva pares de caracteres UTF-16, como emojis.
    if (/^[\uDC00-\uDFFF]$/.test(remaining[end])) end--;
    result.push(remaining.slice(0, end).trimEnd());
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) result.push(remaining);
  return result;
}
