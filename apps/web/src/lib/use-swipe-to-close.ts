import { type PointerEvent, type RefObject, useRef } from "react";

const SWIPE_CLOSE_PX = 80;

/**
 * Am Handy zieht man ein Blatt an Griff oder Titel nach unten weg; das wirkt wie Schließen, der Knopf bleibt die
 * Alternative. `media` ist die Breite, ab der es ein Blatt von unten ist. Beim Schließen bleibt der Versatz stehen,
 * sonst spränge das Blatt erst zurück und führe dann hinaus.
 */
export function useSwipeToClose<T extends HTMLElement>(sheet: RefObject<T | null>, onClose: () => void, media: string) {
  const startY = useRef<number | null>(null);
  const distance = (event: PointerEvent) => Math.max(0, event.clientY - (startY.current ?? event.clientY));
  const reset = () => {
    startY.current = null;
    if (sheet.current) sheet.current.style.translate = "";
  };
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (!window.matchMedia(media).matches) return;
      startY.current = event.clientY;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent) {
      if (startY.current !== null && sheet.current) sheet.current.style.translate = `0 ${distance(event)}px`;
    },
    onPointerUp(event: PointerEvent) {
      if (startY.current === null) return;
      if (distance(event) >= SWIPE_CLOSE_PX) {
        startY.current = null;
        onClose();
      } else reset();
    },
    onPointerCancel: reset,
  };
}
