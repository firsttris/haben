import { type RefObject, useEffect, useState } from "react";

/** Seitenkopf als direktes Kind des Inhalts; jede Seite rendert ihn als ersten Baustein */
const PAGE_HEAD = ":scope > .page-head";

/**
 * Fester Seitenkopf (#356): Die Höhe von `.page-head` steht als `--page-head-height` an der Wurzel, damit
 * Unternavigation, Belegansicht, Tabellenköpfe, Sprungziele und Fokus darunter beginnen statt dahinter zu
 * verschwinden. Der Kopf wechselt mit der Seite und wächst mit seinem Inhalt (umbrechende Aktionen, Meldungen);
 * deshalb wird er bei jedem Wechsel der Kinder neu gesucht und laufend gemessen.
 */
export function usePageHeadHeight(main: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = main.current;
    if (!container) return;
    const root = document.documentElement;
    const setHeight = (px: number) => root.style.setProperty("--page-head-height", `${Math.ceil(px)}px`);
    let head: Element | null = null;
    const resize = new ResizeObserver(([entry]) => setHeight(entry?.borderBoxSize?.[0]?.blockSize ?? entry?.target.getBoundingClientRect().height ?? 0));

    function follow() {
      const next = container?.querySelector(PAGE_HEAD) ?? null;
      if (next === head) return;
      if (head) resize.unobserve(head);
      head = next;
      if (head) resize.observe(head);
      else setHeight(0);
    }

    follow();
    const children = new MutationObserver(follow);
    children.observe(container, { childList: true });
    return () => {
      children.disconnect();
      resize.disconnect();
      root.style.removeProperty("--page-head-height");
    };
  }, [main]);
}

/** Ob die Seite gescrollt ist: Erst dann trennt eine Linie den stehenden Kopf vom Inhalt darunter */
export function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 0);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return scrolled;
}
