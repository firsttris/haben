import { useEffect, useRef, useState, type HTMLAttributes, type RefObject, type TableHTMLAttributes } from "react";

/** true, solange das Element breiter ist als sein Platz und deshalb waagrecht scrollt */
function useScrolls(ref: RefObject<HTMLElement | null>): boolean {
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const check = () => setScrolls(element.scrollWidth > element.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return scrolls;
}

/**
 * Tabelle, die am Handy in der Karte waagrecht scrollt (.report-table unter 720 px). Ist sie breiter
 * als ihr Platz, nimmt sie den Tastaturfokus an, damit sich der Rest mit den Pfeiltasten erreichen
 * lässt (WCAG 2.1.1); passt sie, bleibt sie aus der Tab-Reihenfolge.
 */
export function ScrollTable(props: TableHTMLAttributes<HTMLTableElement>) {
  const ref = useRef<HTMLTableElement>(null);
  const scrolls = useScrolls(ref);
  return <table ref={ref} tabIndex={scrolls ? 0 : undefined} {...props} />;
}

/**
 * Waagrecht scrollender Rahmen um eine Tabelle (.table-scroll) mit demselben Fokusverhalten wie
 * ScrollTable; nötig, wenn in der Tabelle sonst nichts fokussierbar ist (etwa nur Hinweise statt Knöpfe).
 */
export function ScrollBox({ label, ...props }: HTMLAttributes<HTMLDivElement> & { label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrolls = useScrolls(ref);
  return (
    <div
      ref={ref}
      className="table-scroll"
      tabIndex={scrolls ? 0 : undefined}
      role={scrolls ? "region" : undefined}
      aria-label={scrolls ? label : undefined}
      {...props}
    />
  );
}
