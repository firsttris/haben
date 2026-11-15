import { type ReactNode, useEffect, useRef } from "react";

/** Dieselbe Grenze wie in styles.css: darunter stehen die Aktionen in der Leiste, darüber im Seitenkopf */
const NARROW = "(max-width: 860px)";

/**
 * Feste Leiste am unteren Fensterrand für abschließende Formularaktionen (#396). Steht als direktes Kind von `<main>`
 * am Ende des Inhalts, sodass die Tab-Reihenfolge vom letzten Feld direkt in die Aktionen führt und die Leiste nie
 * neben oder über der Navigation liegt.
 *
 * Die Knöpfe stehen zweimal im Markup, im Kopf und in der Leiste, und CSS blendet je nach Breite eine Reihe aus. Wird
 * das Fenster über die Grenze hinweg breiter oder schmaler (auch beim Zoomen, WCAG 1.4.4), verschwände der Knopf mit
 * dem Fokus; der Fokus geht deshalb auf den gleichnamigen Knopf der anderen Reihe (WCAG 2.4.3).
 */
export function ActionBar({ children }: { children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const own = bar.current;
    const head = () => own?.parentElement?.querySelector<HTMLElement>(":scope > .page-head > .actions") ?? null;
    let last: HTMLElement | null = null;
    const remember = (event: FocusEvent) => {
      const target = event.target;
      last = target instanceof HTMLElement && (own?.contains(target) || head()?.contains(target)) ? target : null;
    };
    const follow = () => {
      const from = last;
      const other = from && (own?.contains(from) ? head() : own);
      if (!from || !other || from.getClientRects().length > 0) return;
      if (document.activeElement !== from && document.activeElement !== document.body) return;
      const name = from.textContent?.trim();
      [...other.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent?.trim() === name)?.focus({ preventScroll: true });
    };
    const narrow = window.matchMedia(NARROW);
    document.addEventListener("focusin", remember);
    narrow.addEventListener("change", follow);
    return () => {
      document.removeEventListener("focusin", remember);
      narrow.removeEventListener("change", follow);
    };
  }, []);
  return (
    <div ref={bar} className="action-bar">
      <div className="actions">{children}</div>
    </div>
  );
}
