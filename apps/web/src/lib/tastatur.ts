import { useSyncExternalStore } from "react";

/**
 * Tastenkürzel je System: „mod“ ist am Mac und auf iPhone/iPad die Befehlstaste (⌘), sonst Strg. Angezeigt wird ein
 * Kürzel nur über `Kuerzel` (components/Kuerzel.tsx) oder `useKuerzelText`, nie fest als „Strg“ oder „⌘“ (DESIGN.md).
 */
export type Taste = "mod" | (string & {});

type NavigatorWie = {
  userAgentData?: { platform?: string };
  platform?: string;
  userAgent?: string;
};

/**
 * Ob das Gerät von Apple ist. `navigator.userAgentData` gibt es nur in Chromium, `navigator.platform` ist veraltet, aber
 * in Firefox und Safari noch da; der User-Agent bleibt als Letztes. Leere Werte zählen wie fehlende, daher `||`.
 * iPadOS meldet sich als „MacIntel“ und zählt damit richtig. Ohne Browser (SSR) false: Der Server zeigt „Strg“.
 */
export function istApple(nav: NavigatorWie | undefined = globalThis.navigator): boolean {
  if (!nav) return false;
  const plattform = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /Mac|iPhone|iPad|iPod/i.test(plattform);
}

/** Beschriftung je Taste, so wie sie auf der Tastatur steht */
export function tastenNamen(tasten: readonly Taste[], apple: boolean): string[] {
  return tasten.map((taste) => (taste === "mod" ? (apple ? "⌘" : "Strg") : taste));
}

/** Textform für title und Hinweistexte: „Strg+Enter“ bzw. „⌘+Enter“ */
export function kuerzelText(tasten: readonly Taste[], apple: boolean): string {
  return tastenNamen(tasten, apple).join("+");
}

/**
 * Textform für Screenreader, etwa in versteckten Hinweisen: „Befehlstaste plus Enter“ bzw. „Strg plus Enter“. Das Zeichen
 * ⌘ liest nicht jeder Screenreader als Taste vor, das Wort schon.
 */
export function kuerzelSprache(tasten: readonly Taste[], apple: boolean): string {
  return tasten.map((taste) => (taste === "mod" ? (apple ? "Befehlstaste" : "Strg") : taste)).join(" plus ");
}

/** Wert für aria-keyshortcuts: „mod“ gilt mit Strg und mit der Befehlstaste, wie die Tastaturbehandlung (ctrlKey || metaKey) */
export function ariaKuerzel(tasten: readonly Taste[]): string {
  if (!tasten.includes("mod")) return tasten.join("+");
  const mit = (statt: string) => tasten.map((taste) => (taste === "mod" ? statt : taste)).join("+");
  return `${mit("Control")} ${mit("Meta")}`;
}

const nieAendern = () => () => {};

/** Ob Apple; beim Rendern auf dem Server und beim Hydrieren false, danach der Wert des Browsers */
export function useApple(): boolean {
  return useSyncExternalStore(nieAendern, istApple, () => false);
}

export function useKuerzelText(tasten: readonly Taste[]): string {
  return kuerzelText(tasten, useApple());
}
