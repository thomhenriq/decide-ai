import { useCallback, useEffect, useRef, useState } from 'react';
import { canScrollChat, createWheelPager, pageAfterGesture } from '../services/pageNavigation';
import type { ChatPage } from '../services/pageNavigation';

type TouchGesture = {
  id: number; x: number; y: number; dx: number; dy: number;
  area: { scrollTop: number; scrollHeight: number; clientHeight: number } | null;
  mode?: 'history' | 'page' | 'horizontal';
};

export function useChatPages() {
  const stage = useRef<HTMLElement>(null);
  const [activePage, setActivePage] = useState<ChatPage>(0);
  const page = useRef<ChatPage>(0);

  const selectPage = useCallback((next: ChatPage) => {
    if (next === page.current) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && stage.current?.contains(focused) && focused.matches('input, textarea, [contenteditable="true"]')) focused.blur();
    page.current = next;
    setActivePage(next);
  }, []);

  useEffect(() => {
    const root = stage.current;
    if (!root) return;
    const mobile = window.matchMedia('(max-width: 760px)');
    const wheel = createWheelPager();
    let gesture: TouchGesture | undefined;

    const element = (target: EventTarget | null) => target instanceof Element ? target : null;
    const blocked = (target: EventTarget | null) => !!root.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') ||
      !!element(target)?.closest('input, textarea, button, a, audio, select, [contenteditable]:not([contenteditable="false"])');
    const areaAt = (target: EventTarget | null) => element(target)?.closest<HTMLElement>('.chat-body') ?? null;

    const touchStart = (event: TouchEvent) => {
      gesture = undefined;
      if (!mobile.matches || event.touches.length !== 1 || blocked(event.target)) return;
      const touch = event.touches[0];
      const area = areaAt(event.target);
      gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, dx: 0, dy: 0,
        area: area ? { scrollTop: area.scrollTop, scrollHeight: area.scrollHeight, clientHeight: area.clientHeight } : null };
    };
    const touchMove = (event: TouchEvent) => {
      if (!gesture) return;
      if (!mobile.matches || event.touches.length !== 1) { gesture = undefined; return; }
      const touch = Array.from(event.touches).find(item => item.identifier === gesture!.id);
      if (!touch) return;
      gesture.dx = gesture.x - touch.clientX;
      gesture.dy = gesture.y - touch.clientY;
      if (!gesture.mode && Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy)) > 8) {
        gesture.mode = Math.abs(gesture.dy) <= Math.abs(gesture.dx) * 1.25 ? 'horizontal'
          : canScrollChat(gesture.area, gesture.dy) ? 'history' : 'page';
      }
      // Só bloqueia o gesto de navegação; o histórico mantém a rolagem nativa.
      if (gesture.mode === 'page' && event.cancelable) event.preventDefault();
    };
    const touchEnd = (event: TouchEvent) => {
      const finished = gesture;
      gesture = undefined;
      if (!finished || !mobile.matches || finished.mode !== 'page') return;
      const touch = Array.from(event.changedTouches).find(item => item.identifier === finished.id);
      if (touch) selectPage(pageAfterGesture(page.current, finished.x - touch.clientX, finished.y - touch.clientY));
    };
    const cancel = () => { gesture = undefined; wheel.reset(); };
    const onWheel = (event: WheelEvent) => {
      if (!mobile.matches || blocked(event.target) || event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientHeight : 1;
      const delta = event.deltaY * multiplier;
      const historyCanScroll = canScrollChat(areaAt(event.target), delta);
      const result = wheel.move(page.current, delta, historyCanScroll, Date.now());
      if (result.consume && event.cancelable) event.preventDefault();
      selectPage(result.page);
    };

    root.addEventListener('touchstart', touchStart, { passive: true });
    root.addEventListener('touchmove', touchMove, { passive: false });
    root.addEventListener('touchend', touchEnd, { passive: true });
    root.addEventListener('touchcancel', cancel, { passive: true });
    root.addEventListener('wheel', onWheel, { passive: false });
    mobile.addEventListener('change', cancel);
    return () => {
      root.removeEventListener('touchstart', touchStart);
      root.removeEventListener('touchmove', touchMove);
      root.removeEventListener('touchend', touchEnd);
      root.removeEventListener('touchcancel', cancel);
      root.removeEventListener('wheel', onWheel);
      mobile.removeEventListener('change', cancel);
    };
  }, [selectPage]);

  return { stage, activePage, selectPage };
}
