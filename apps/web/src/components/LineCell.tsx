import type { ReactNode } from "react";

/**
 * Ein Feld in der Zahlenzeile einer Position. Am Desktop benennt die Kopfzeile die Spalten, am Handy steht der Name
 * über dem Feld. Den zugänglichen Namen mit der Positionsnummer trägt das Feld selbst (aria-label), deshalb ist der
 * sichtbare Name für Screenreader ausgeblendet.
 */
export function LineCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="line-cell">
      <span className="line-cell-label" aria-hidden="true">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Der berechnete Betrag einer Position, am Handy mit Namen wie die Felder daneben */
export function LineAmount({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="line-cell line-net">
      <span className="line-cell-label">{label}</span>
      <span className="line-net-value">{children}</span>
    </div>
  );
}
