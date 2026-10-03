import { useCallback, useRef, useState, type RefCallback } from "react";

/** Achsenbeschriftung in vollen Euro */
export const euroAxis = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

/** Runde Achsenwerte in Cent, die min und max einschließen */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const range = Math.max(max - min, 100_00);
  const raw = range / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) ticks.push(v);
  return ticks;
}

/**
 * Breite des Diagramm-Containers in Pixeln. Das SVG bekommt sie als viewBox-Breite, damit die Schrift
 * überall so groß ist wie im CSS (11px) statt mit dem Diagramm gestreckt oder gestaucht zu werden.
 * Bis zum ersten Messen (und auf dem Server) gilt der Vorgabewert.
 */
export function useChartWidth(fallback = 720): [RefCallback<HTMLDivElement>, number] {
  const [width, setWidth] = useState(fallback);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!node) return;
    const measure = () => {
      const w = Math.round(node.clientWidth);
      if (w > 0) setWidth(Math.max(280, w));
    };
    measure();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(node);
  }, []);
  return [ref, width];
}
