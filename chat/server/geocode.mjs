const TIMEOUT_MS = 4000;

/**
 * Converte coordenadas em { bairro, cidade } pelo OpenStreetMap (Nominatim).
 * As coordenadas só são usadas nesta consulta: nunca vão para o banco.
 * O cache usa coordenadas arredondadas (~100 m) e evita repetir a consulta a cada mensagem.
 */
export function createReverseGeocoder({ fetchImpl = fetch } = {}) {
  const cache = new Map();
  return async ({ latitude, longitude }) => {
    const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
    if (cache.has(key)) return cache.get(key);
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=16&accept-language=pt-BR&lat=${latitude}&lon=${longitude}`;
    try {
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': 'decide-ai-hackathon/1.0 (prototipo local)' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return {};
      const { address = {} } = await response.json();
      const regiao = {
        bairro: address.suburb || address.neighbourhood || address.quarter || address.city_district || undefined,
        cidade: address.city || address.town || address.municipality || address.village || undefined,
      };
      cache.set(key, regiao);
      return regiao;
    } catch {
      return {};
    }
  };
}
