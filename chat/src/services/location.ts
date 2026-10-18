import type { UserLocation } from '../types';

const TIMEOUT_MS = 10_000;
// Posições com até 5 minutos são reaproveitadas sem acionar o GPS de novo.
const MAX_AGE_MS = 5 * 60 * 1000;

let pending: Promise<UserLocation | undefined> | undefined;

/**
 * Pede a localização ao navegador. Na primeira vez, o navegador mostra o pedido de autorização.
 * Se o cliente negar, o navegador não suportar ou a página não estiver em HTTPS/localhost, devolve
 * undefined e o agente pergunta o endereço no chat.
 */
export function getUserLocation(): Promise<UserLocation | undefined> {
  if (!('geolocation' in navigator) || !window.isSecureContext) return Promise.resolve(undefined);
  pending ??= new Promise<UserLocation | undefined>(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: Math.round(position.coords.accuracy),
      }),
      error => {
        console.info('[chat:location:unavailable]', error.message);
        resolve(undefined);
      },
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: MAX_AGE_MS },
    );
  }).then(location => {
    // Uma recusa não fica guardada: se o cliente liberar depois nas configurações, a próxima mensagem já usa o GPS.
    if (!location) pending = undefined;
    else setTimeout(() => { pending = undefined; }, MAX_AGE_MS);
    return location;
  });
  return pending;
}
