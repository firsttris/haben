import { useCallback, useRef, useState, type RefCallback } from "react";

/** Achsenbeschriftung in vollen Euro */
export const euroAxis = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

/** Runde Achsenwerte in Cent, die min und max einschließen */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const range = Math.max(max - min, 100_00);
  const raw = range / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw)!;
  const first = Math.floor(min / step) * step;
  // Mindestens bis zur Spanne über dem kleinsten Wert: Bei min = max = 0 gäbe es sonst nur einen Achsenwert, und das
  // Diagramm teilte durch null (NaN in den SVG-Attributen)
  const last = Math.max(Math.ceil(max / step) * step, first + step);
  const ticks: number[] = [];
  for (let v = first; v <= last + step / 2; v += step) ticks.push(v);
  return ticks;
}

/** Balken mit 4px runder Datenkante, eckig an der Grundlinie */
export function barPath(x: number, y0: number, y1: number, w: number): string {
  const h = Math.abs(y1 - y0);
  if (h < 0.5) return "";
  const r = Math.min(4, h, w / 2);
  if (y1 < y0) {
    // positiv: nach oben
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
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
