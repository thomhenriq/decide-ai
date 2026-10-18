export type ChatPage = 0 | 1;
export const SWIPE_THRESHOLD = 96;
export const WHEEL_THRESHOLD = 120;
const WHEEL_PAUSE = 240;

export function pageAfterGesture(page: ChatPage, deltaX: number, deltaY: number, threshold = SWIPE_THRESHOLD): ChatPage {
  if (Math.abs(deltaY) < threshold || Math.abs(deltaY) <= Math.abs(deltaX) * 1.25) return page;
  return deltaY > 0 ? 1 : 0;
}

export function canScrollChat(area: { scrollTop: number; scrollHeight: number; clientHeight: number } | null, deltaY: number): boolean {
  if (!area || area.scrollHeight - area.clientHeight <= 1) return false;
  return deltaY > 0 ? area.scrollTop + area.clientHeight < area.scrollHeight - 1 : area.scrollTop > 1;
}

/** Uma rajada da roda/trackpad só pode trocar uma página, mesmo com inércia. */
export function createWheelPager() {
  let lastTime = -Infinity;
  let distance = 0;
  let mode: 'history' | 'page' | 'done' | undefined;
  return {
    reset() { lastTime = -Infinity; distance = 0; mode = undefined; },
    move(page: ChatPage, deltaY: number, historyCanScroll: boolean, time: number): { page: ChatPage; consume: boolean } {
      if (time - lastTime > WHEEL_PAUSE) { distance = 0; mode = undefined; }
      lastTime = time;
      mode ??= historyCanScroll ? 'history' : 'page';
      if (mode !== 'page') return { page, consume: mode === 'done' };
      if (Math.sign(distance) !== Math.sign(deltaY)) distance = 0;
      distance += deltaY;
      const next = pageAfterGesture(page, 0, distance, WHEEL_THRESHOLD);
      if (next !== page) mode = 'done';
      return { page: next, consume: true };
    },
  };
}
