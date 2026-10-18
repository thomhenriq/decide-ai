import { useEffect, useRef } from 'react';

export function resizeTextarea(field: HTMLTextAreaElement) {
  field.style.height = 'auto';
  // Um chat com display:none mede zero; deixe rows/min-height definir a altura ao abri-lo.
  if (field.scrollHeight > 0) field.style.height = `${Math.min(field.scrollHeight, 112)}px`;
}

export function observeTextareaWidth(field: HTMLTextAreaElement, Observer = globalThis.ResizeObserver): () => void {
  if (typeof Observer !== 'function') return () => {};
  let width = field.clientWidth;
  const observer = new Observer(() => {
    const nextWidth = field.clientWidth;
    if (nextWidth === width) return;
    width = nextWidth;
    if (width > 0) resizeTextarea(field);
  });
  observer.observe(field);
  return () => observer.disconnect();
}

export function useTextareaAutosize(value: string) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (input.current) resizeTextarea(input.current); }, [value]);
  useEffect(() => {
    if (input.current) return observeTextareaWidth(input.current);
  }, []);
  return input;
}
