import { etsyLedgerBatch, type EtsyLedgerEntry, validateBatch } from "@haben/import";

/*
 * Jeder Abruf des Etsy-Zahlungsverlaufs läuft zusätzlich durch den Importvertrag (#306), wie der Abruf über Enable
 * Banking seit Schritt 2. Die Prüfung meldet nur, im Ergebnis des Abrufs; gespeichert wird weiter über
 * `parseEtsyLedger` und `storeStatement`, und die Meldungen landen nicht im Importprotokoll. Sie läuft nach dem
 * Speichern und kann es deshalb nie aufhalten. Verbindlich wird sie mit der Quellenbindung in Schritt 3; Kontokennung
 * ist die Kennung des Shops.
 *
 * Was `parseEtsyLedger` schon meldet (unbekannter Typ, fremde Währung), meldet sie nicht noch einmal.
 */

export interface EtsyVertragAbruf {
  shopId: string;
  entries: EtsyLedgerEntry[];
  /** Erster abgerufener Tag (UTC), YYYY-MM-DD */
  fetchFrom: string;
  now: Date;
  orderFor?: (referenceId: string) => string | undefined;
}

/** Höchstens so viele Gründe einer abgelehnten Lieferung im Ergebnis; der Rest als Anzahl */
const MAX_GRUENDE = 3;

export function etsyVertragHinweise(abruf: EtsyVertragAbruf): string[] {
  try {
    const heute = abruf.now.toISOString().slice(0, 10);
    const batch = etsyLedgerBatch({
      shopId: abruf.shopId,
      entries: abruf.entries,
      dateFrom: abruf.fetchFrom,
      dateTo: heute,
      fetchedAt: abruf.now.toISOString(),
      fetchId: `etsy-${abruf.now.toISOString()}`,
      orderFor: abruf.orderFor,
    });
    const hinweise: string[] = [];
    const ohneKennung = abruf.entries.filter((e) => e.entry_id === undefined).length;
    if (ohneKennung > 0) {
      hinweise.push(
        `${ohneKennung} ${ohneKennung === 1 ? "Zeile" : "Zeilen"} ohne Kennung (entry_id): gespeichert wie bisher; ein späterer Abruf erkennt sie nicht sicher wieder.`,
      );
    }
    const result = validateBatch(batch, { provider: "etsy", externalAccountId: abruf.shopId, accountKind: "psp" });
    if (!result.ok) {
      const gruende = result.problems.slice(0, MAX_GRUENDE).join(" ");
      const rest = result.problems.length - MAX_GRUENDE;
      return [...hinweise, `Prüfung nach dem Importvertrag: ${gruende}${rest > 0 ? ` (und ${rest} weitere)` : ""}`];
    }
    return [...hinweise, ...result.hints];
  } catch (error) {
    // Die Prüfung ist nur eine Meldung; ein Fehler in ihr darf den schon gespeicherten Abruf nicht als gescheitert zeigen
    return [`Prüfung nach dem Importvertrag nicht möglich: ${error instanceof Error ? error.message : String(error)}`];
  }
}
