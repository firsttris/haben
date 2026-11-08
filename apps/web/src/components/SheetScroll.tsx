import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

/**
 * Bereich, in dem das Blatt scrollt. Ist es höher als der Bereich, nimmt er den Fokus an, damit es sich mit den
 * Pfeiltasten scrollen lässt (WCAG 2.1.1, axe „scrollable-region-focusable“); passt es, bleibt er aus der Tab-Reihenfolge.
 * An der Kante, hinter der es weitergeht, läuft das Blatt in einem Verlauf aus; der Rahmen darum bleibt stehen.
 */
export function SheetScroll({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const { paddingTop, paddingBottom } = getComputedStyle(element);
    const remaining = element.scrollHeight - element.clientHeight - element.scrollTop;
    setScrolls(element.scrollHeight > element.clientHeight + 1);
    // Direkt am Rahmen statt über den Zustand: Das läuft bei jedem Scrollschritt
    element.parentElement?.style.setProperty("--fade-top", fadeStrength(element.scrollTop, parseFloat(paddingTop)));
    element.parentElement?.style.setProperty("--fade-bottom", fadeStrength(remaining, parseFloat(paddingBottom)));
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    measure();
    // Auch das Blatt beobachten: Es wächst mit jeder Position, der Bereich selbst bleibt gleich hoch
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div className="sheet-frame">
      <div
        ref={ref}
        className={className}
        tabIndex={scrolls ? 0 : undefined}
        role={scrolls ? "region" : undefined}
        aria-label={scrolls ? "Blatt der Vorschau" : undefined}
        onScroll={measure}
      >
        {children}
      </div>
    </div>
  );
}

/** Der Verlauf ist voll, sobald die Blattkante den Rand des Bereichs erreicht, und wächst über den Innenabstand davor */
function fadeStrength(distance: number, padding: number): string {
  return distance <= 1 ? "0" : String(Math.min(distance / Math.max(padding, 1), 1));
}
