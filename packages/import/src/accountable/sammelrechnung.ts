import { categoryForCode } from "./map.ts";
import type { AccountableExpenseRow } from "./types.ts";

/**
 * Accountable führt eine Rechnung mit mehreren Buchungscodes als mehrere Zeilen im
 * Ausgabenblatt. Im Export steht keine Belegnummer, an der man die Zeilen wieder
 * zusammenbinden könnte; gleich sind nur Lieferant und Buchungsdatum.
 *
 * Spalte Y (Dokument vorhanden) gilt dabei für die ganze Rechnung: sie steht auch an den
 * Zeilen, die keinen eigenen Dateinamen tragen. Im Belege-Ordner liegt die Datei einmal,
 * benannt nach Datum und Lieferant. Wer die Zeilen einzeln übernimmt, bekommt deshalb
 * einen Beleg ueber den Teilbetrag einer Zeile, während der Rest ohne Buchung bleibt.
 * Deshalb dieser Vorschlag: Zeilen mit gleichem Lieferanten und Datum gelten als eine
 * Rechnung mit Aufteilung.
 *
 * Das bleibt eine Annahme. Zwei getrennte Käufe beim selben Händler am selben Tag sehen
 * genauso aus. Für den gebuchten Aufwand ist der Unterschied trotzdem nicht gleichgültig:
 * einzeln übernommen bekommt nur die Zeile mit Belegdatei eine Buchung, die übrigen bleiben
 * ohne Beleg und fehlen in der EÜR. Die Gruppierung sorgt dafür, dass die ganze Rechnung
 * gebucht wird; die Summe der Zeilen ist in beiden Fällen dieselbe.
 */
export interface AccountableSplitPosition {
  /** M, etwa „0490“ */
  code: string;
  /** Konto in Haben; null, wenn der Code nicht zugeordnet ist */
  category: ReturnType<typeof categoryForCode>;
  /** J in Basispunkten */
  taxRate: number;
  /** F in Cent */
  net: number;
  /** G in Cent */
  tax: number;
}

export interface AccountableSammelrechnung {
  supplierName: string;
  /** A, JJJJ-MM-TT */
  bookingDate: string;
  /** Summe der Zeilen in Cent */
  gross: number;
  net: number;
  tax: number;
  /** In der Reihenfolge des Exports */
  positions: AccountableSplitPosition[];
  /** Zeilennummern im Ausgabenblatt, die hier aufgehen */
  rows: number[];
}

/**
 * Nur vollständige Zeilen in Euro: bei Fremdwährung ohne Eurobetrag fehlt die Grundlage.
 * Reverse Charge bleibt draußen, dort rechnet Haben die Steuer aus dem Netto, und eine
 * Mischung aus § 13b und normalen Positionen wäre in einem Beleg nicht mehr nachvollziehbar.
 */
function gruppierbar(e: AccountableExpenseRow): boolean {
  return (
    e.bookingDate !== null &&
    e.supplierName !== null &&
    e.gross !== null &&
    e.net !== null &&
    e.tax !== null &&
    e.taxRate !== null &&
    (e.currency === "" || e.currency === "EUR") &&
    e.taxStatus !== "Importieren" &&
    // Y ist true, sobald zu der Rechnung eine Datei existiert, auch an den Zeilen ohne
    // eigenen Dateinamen. Ein false heißt: zu dieser Zeile gibt es gar keinen Beleg.
    e.documentPresent !== false
  );
}

const schluessel = (e: AccountableExpenseRow): string => `${e.supplierName ?? ""}\u0000${e.bookingDate ?? ""}`;

function gruppen(expenses: readonly AccountableExpenseRow[]): Map<string, AccountableExpenseRow[]> {
  const karte = new Map<string, AccountableExpenseRow[]>();
  for (const e of expenses) {
    if (!gruppierbar(e)) continue;
    const key = schluessel(e);
    const liste = karte.get(key);
    if (liste) liste.push(e);
    else karte.set(key, [e]);
  }
  for (const [key, liste] of karte) if (liste.length < 2) karte.delete(key);
  return karte;
}

/**
 * Liefert je Lieferant und Tag eine Rechnung, sobald dort mehr als eine Zeile steht.
 * Einzelzeilen kommen nicht vor: die übernimmt der Aufrufer wie bisher.
 */
export function sammelrechnungen(expenses: readonly AccountableExpenseRow[]): AccountableSammelrechnung[] {
  const ergebnis: AccountableSammelrechnung[] = [];
  for (const zeilen of gruppen(expenses).values()) {
    const erste = zeilen[0];
    if (!erste?.supplierName || !erste.bookingDate) continue;
    ergebnis.push({
      supplierName: erste.supplierName,
      bookingDate: erste.bookingDate,
      gross: zeilen.reduce((s, e) => s + (e.gross ?? 0), 0),
      net: zeilen.reduce((s, e) => s + (e.net ?? 0), 0),
      tax: zeilen.reduce((s, e) => s + (e.tax ?? 0), 0),
      rows: zeilen.map((e) => e.row),
      positions: zeilen.map((e) => ({
        code: e.code,
        category: categoryForCode(e.code, e.net ?? 0),
        taxRate: e.taxRate ?? 0,
        net: e.net ?? 0,
        tax: e.tax ?? 0,
      })),
    });
  }
  return ergebnis;
}

/** Die Zeilennummern, die in einer Sammelrechnung aufgehen; der Aufrufer überspringt sie. */
export function zeilenInSammelrechnungen(expenses: readonly AccountableExpenseRow[]): Set<number> {
  const zeilen = new Set<number>();
  for (const liste of gruppen(expenses).values()) for (const e of liste) zeilen.add(e.row);
  return zeilen;
}
