import { useEffect, useRef, useState, type TableHTMLAttributes } from "react";

/**
 * Tabelle, die am Handy in der Karte waagrecht scrollt (.report-table unter 720 px). Ist sie breiter
 * als ihr Platz, nimmt sie den Tastaturfokus an, damit sich der Rest mit den Pfeiltasten erreichen
 * lässt (WCAG 2.1.1); passt sie, bleibt sie aus der Tab-Reihenfolge.
 */
export function ScrollTable(props: TableHTMLAttributes<HTMLTableElement>) {
  const ref = useRef<HTMLTableElement>(null);
  const [scrolls, setScrolls] = useState(false);

  useEffect(() => {
    const table = ref.current;
    if (!table) return;
    const check = () => setScrolls(table.scrollWidth > table.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(table);
    return () => observer.disconnect();
  }, []);

  return <table ref={ref} tabIndex={scrolls ? 0 : undefined} {...props} />;
}
