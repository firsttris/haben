import { zeilenImKontenrahmen, type Kontenrahmen, type PostingLine } from "@haben/core";
import { LedgerError } from "./ledger.ts";

/** Gegenbuchung zu den Zeilen einer Buchung: Soll und Haben getauscht */
export function reverseLines(lines: PostingLine[]): PostingLine[] {
  // Die Bemessungsgrundlage trägt ihr Vorzeichen selbst (#542) und dreht sich mit
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit, ...(l.basis != null ? { basis: -l.basis } : {}) }));
}

/**
 * Gegenbuchung zu den Zeilen einer Buchung im Kontenrahmen `von`, gebucht im eingestellten Kontenrahmen `nach`. Nach einem
 * Wechsel zum Jahreswechsel (Storno einer Bareinnahme, Aufheben einer Ausbuchung aus dem Vorjahr) mit den Konten derselben
 * Rolle im neuen Rahmen (kontoImKontenrahmen); die alten Kontonummern bedeuteten dort etwas anderes. Lässt sich ein Konto
 * nicht eindeutig übertragen, geht die Gegenbuchung nicht.
 */
export function reverseLinesIn(von: Kontenrahmen, nach: Kontenrahmen, lines: PostingLine[]): PostingLine[] {
  const uebertragen = zeilenImKontenrahmen(von, nach, lines);
  if (!uebertragen) {
    throw new LedgerError(
      `Die Buchung ist im Kontenrahmen ${von} gebucht, eingestellt ist jetzt ${nach}; nicht jedes Konto hat dort eine eindeutige Entsprechung. Stornieren geht nach dem Wechsel deshalb nicht.`,
    );
  }
  return reverseLines(uebertragen);
}
