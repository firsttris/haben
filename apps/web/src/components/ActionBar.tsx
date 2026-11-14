import type { ReactNode } from "react";

/**
 * Feste Leiste am unteren Fensterrand für abschließende Formularaktionen (#396). Steht als direktes Kind von `<main>`
 * am Ende des Inhalts, sodass die Tab-Reihenfolge vom letzten Feld direkt in die Aktionen führt und die Leiste nie
 * neben oder über der Navigation liegt.
 */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="action-bar">
      <div className="actions">{children}</div>
    </div>
  );
}
