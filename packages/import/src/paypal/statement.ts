import { parsePayPal } from "../psp.ts";
import type { ParsedStatement } from "../types.ts";
import { counterpartyOf, euro, type PayPalEntry } from "./eintraege.ts";

/*
 * Ein Abruf der Transaction Search als Kontoauszug, zugleich zur Lieferung von `paypalBatch` (Importvertrag, #306, #1512).
 * Gespeichert wird der Auszug, die Lieferung ordnet ihm die Quellenidentität zu. Damit ein Umsatz aus dem Abruf nach
 * denselben Regeln entsteht wie einer aus dem Aktivitätenexport (Brutto und Gebühr getrennt, Gebühr unter `<Code>-gebuehr`,
 * Zweck aus Art, Rechnungsnummer, Betreff und Transaktionscode), werden die Zeilen der API zu den Spalten des englischen
 * Exports (`Date`, `Name`, `Type`, `Status`, `Currency`, `Gross`, `Fee`, `Net`, `Transaction ID`, `Invoice Number`,
 * `Subject`), und `parsePayPal` macht daraus die Umsätze.
 *
 * Grenzen, soweit sie sich ohne echte Daten sagen lassen:
 * - Die Spalte „Type“ ist im Export die Beschreibung des T-Codes in der Sprache des Kontos, in der API gibt es nur den Code.
 *   Haben setzt die englische Beschreibung aus der T-Code-Tabelle ein. Sie geht in den Zweck und damit in den Dubletten-Hash:
 *   Bei einem deutschen Export gälte die Zahlung aus Datei und Abruf als verschieden. Die Gebührenzeile hat keine Art im Zweck und
 *   passt immer.
 * - „Date“ ist im Export der Tag der Fertigstellung in der Zeitzone des Kontos, die API liefert `transaction_initiation_date`
 *   (Beginn der Transaktion). Beide fallen bei sofortigen Zahlungen auf denselben Tag, bei verzögerten (Lastschrift) nicht.
 */

/** Spalten des englischen Exports; `Subject` ist der Betreff, ersatzweise der Artikelname */
const HEADER = ["Date", "Name", "Type", "Status", "Currency", "Gross", "Fee", "Net", "Transaction ID", "Invoice Number", "Subject"];

export function paypalStatement(entries: PayPalEntry[]): ParsedStatement {
  const rows = [
    HEADER,
    ...entries.map((e) => [
      e.bookingDate,
      counterpartyOf(e),
      e.typeText,
      // S und V sind gebuchte Zeilen; was nicht gebucht ist, kommt gar nicht erst hierher (`classify`)
      "Completed",
      "EUR",
      euro(e.tx.amount),
      euro(e.tx.fee),
      euro(e.tx.amount + e.tx.fee),
      e.eventId,
      e.tx.invoiceId ?? "",
      e.tx.subject ?? e.tx.itemTitle ?? "",
    ]),
  ];
  return { ...parsePayPal(rows, 0), format: "paypal-api" };
}

/** Bankreferenz der Gebührenzeile, wie `parsePayPal` sie vergibt */
const GEBUEHR = "-gebuehr";

/**
 * Schlüssel der Bewegung zu einem Umsatz des Auszugs, nach `eventKey` im Modul bank: der Hauptbetrag unter der
 * Transaktions-ID, die Gebühr mit dem Zusatz `#fee`. `undefined`, wenn die Bewegung der Lieferung fehlt.
 */
export function paypalEventOf(movementKeys: ReadonlySet<string>) {
  return (t: { bankReference?: string }): string | undefined => {
    const ref = t.bankReference;
    if (!ref) return undefined;
    const key = ref.endsWith(GEBUEHR) ? `${ref.slice(0, -GEBUEHR.length)}#fee` : ref;
    return movementKeys.has(key) ? key : undefined;
  };
}
