import { type RefObject, useEffect, useRef, useState } from "react";

/** Seitenkopf als direktes Kind des Inhalts; jede Seite rendert ihn als ersten Baustein */
const PAGE_HEAD = ":scope > .page-head";

function setPageHeadHeight(px: number): void {
  document.documentElement.style.setProperty("--page-head-height", `${Math.ceil(px)}px`);
}

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
    let head: Element | null = null;
    const resize = new ResizeObserver(([entry]) =>
      setPageHeadHeight(entry?.borderBoxSize?.[0]?.blockSize ?? entry?.target.getBoundingClientRect().height ?? 0),
    );

    function follow() {
      const next = container?.querySelector(PAGE_HEAD) ?? null;
      if (next === head) return;
      if (head) resize.unobserve(head);
      head = next;
      if (head) resize.observe(head);
      else setPageHeadHeight(0);
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

/**
 * Holt ein Element ins Bild, sobald `active` gesetzt ist. Die Aktionen stehen mit dem Kopf (#356) und lassen sich weit
 * unten auf der Seite klicken; was sie oben unter dem Kopf melden oder nachfragen, läge sonst außer Sicht.
 */
export function useRevealWhen<T extends Element>(active: unknown): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    // Der längere Knopf einer Rückfrage kann den Kopf im selben Moment wachsen lassen; der ResizeObserver meldet das
    // erst nach diesem Effekt, und scroll-padding-top rechnete sonst mit der alten Höhe
    const head = document.querySelector(".main > .page-head");
    if (head) setPageHeadHeight(head.getBoundingClientRect().height);
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return ref;
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
