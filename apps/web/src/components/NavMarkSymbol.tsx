import type { NavMark } from "../lib/navigation.ts";

/**
 * Das Zeichen links neben „Haben“, fest quadratisch (styles.css): das Logo auf weißer Fläche (Logos sind für Papier gemacht), das „H“ in eigener Farbe
 * oder das „H“ in `--brand` des Themes. Farbe als Inline-Style ist die Ausnahme aus DESIGN.md (Farben und Themes).
 */
export function NavMarkSymbol({ mark }: { mark: NavMark }) {
  if (mark && "logo" in mark) return <img className="brand-logo" src={mark.logo} alt="" width={48} height={48} />;
  return (
    <span className="brand-mark" style={mark ? { background: mark.background, color: mark.ink } : undefined}>
      H
    </span>
  );
}
