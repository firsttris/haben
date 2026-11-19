import { formatEuro, gruppiereGebuehren } from "@haben/core";
import { useMemo } from "react";

/**
 * Zahlung und Gebühr derselben Bewegung in einer Zeile (`zahlung-gebuehr.ts` in `@haben/core`); `sichtbar` sind die
 * Umsätze der Zeilen, `index` die Stelle des gewählten Umsatzes darin (−1, wenn er nicht in der Liste steht).
 */
export function useGebuehrZeilen<T extends { id: string; bankAccountId: string; bankReference: string | null; amount: number; open: number }>(
  umsaetze: readonly T[],
  konten: readonly { id: string; purpose: string }[],
  selectedId: string | undefined,
) {
  const dienstleister = useMemo(() => new Set(konten.filter((k) => k.purpose === "zahlungsdienstleister").map((k) => k.id)), [konten]);
  const zeilen = useMemo(() => gruppiereGebuehren(umsaetze, dienstleister), [umsaetze, dienstleister]);
  const sichtbar = useMemo(() => zeilen.map((z) => z.umsatz), [zeilen]);
  return { zeilen, sichtbar, index: sichtbar.findIndex((t) => t.id === selectedId) };
}

/** Betrag des Umsatzes mit Vorzeichen, bei einer Zahlung mit Gebühr darunter die Gebühr */
export function UmsatzBetrag({ betrag, gebuehr }: { betrag: number; gebuehr: number | null }) {
  return (
    <div className="num" style={{ color: betrag > 0 ? "var(--accent-ink)" : undefined }}>
      {betrag > 0 ? "+" : "−"}
      {formatEuro(Math.abs(betrag))}
      {gebuehr !== null && (
        <div className="small muted" title="Gebühr derselben Bewegung">
          Gebühr −{formatEuro(Math.abs(gebuehr))}
        </div>
      )}
    </div>
  );
}
