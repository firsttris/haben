import { type RefObject, useEffect, useRef, useState } from "react";

/** Seitenkopf und Aktionsleiste als direkte Kinder des Inhalts */
const PAGE_HEAD = ":scope > .page-head";
const ACTION_BAR = ":scope > .action-bar";

function setCssHeight(name: string, px: number): void {
  document.documentElement.style.setProperty(name, `${Math.ceil(px)}px`);
}

function observeChildHeight(container: HTMLElement, selector: string, cssVar: string): () => void {
  let target: Element | null = null;
  const resize = new ResizeObserver(([entry]) =>
    setCssHeight(cssVar, entry?.borderBoxSize?.[0]?.blockSize ?? entry?.target.getBoundingClientRect().height ?? 0),
  );

  function follow() {
    const next = container.querySelector(selector);
    if (next === target) return;
    if (target) resize.unobserve(target);
    target = next;
    if (target) resize.observe(target);
    else setCssHeight(cssVar, 0);
  }

  follow();
  const children = new MutationObserver(follow);
  children.observe(container, { childList: true });
  return () => {
    children.disconnect();
    resize.disconnect();
    document.documentElement.style.removeProperty(cssVar);
  };
}

/**
 * Fester Seitenkopf (#356) und feste Aktionsleiste (#396): Die Höhen stehen als `--page-head-height` und
 * `--action-bar-height` an der Wurzel, damit Unternavigation, Belegansicht, Tabellenköpfe, Sprungziele und Fokus
 * nicht dahinter verschwinden. Beide wechseln mit der Seite; deshalb werden sie bei jedem Wechsel der Kinder neu
 * gesucht und laufend gemessen.
 */
export function usePageHeadHeight(main: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = main.current;
    if (!container) return;
    const stopHead = observeChildHeight(container, PAGE_HEAD, "--page-head-height");
    const stopBar = observeChildHeight(container, ACTION_BAR, "--action-bar-height");
    return () => {
      stopHead();
      stopBar();
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
    if (head) setCssHeight("--page-head-height", head.getBoundingClientRect().height);
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
