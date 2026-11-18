import { formatEuro, gruppiereGebuehren } from "@haben/core";
import { useMemo } from "react";

/** Zahlung und Gebühr derselben Bewegung in einer Zeile (`zahlung-gebuehr.ts` in `@haben/core`); `sichtbar` sind die Umsätze der Zeilen */
export function useGebuehrZeilen<T extends { id: string; bankAccountId: string; bankReference: string | null; amount: number; open: number }>(
  umsaetze: readonly T[],
  dienstleister: ReadonlySet<string>,
) {
  const zeilen = useMemo(() => gruppiereGebuehren(umsaetze, dienstleister), [umsaetze, dienstleister]);
  const sichtbar = useMemo(() => zeilen.map((z) => z.umsatz), [zeilen]);
  return { zeilen, sichtbar };
}

/** Die Gebühr unter dem Betrag der Zahlung */
export function GebuehrZeile({ betrag }: { betrag: number }) {
  return (
    <div className="small muted" title="Gebühr derselben Bewegung">
      Gebühr −{formatEuro(Math.abs(betrag))}
    </div>
  );
}
