/** O arquivo original é preservado; o CSS enquadra cada aplicação da marca. */
export function BrandLogo({ symbol = false, wordmark = false }: { symbol?: boolean; wordmark?: boolean }) {
  return <span className={`brand-logo brand-logo--${symbol ? 'symbol' : wordmark ? 'wordmark' : 'full'}`}>
    <img src="/brand/decide-ai.png" alt="Decide Aí" width={1254} height={1254} />
  </span>;
}
