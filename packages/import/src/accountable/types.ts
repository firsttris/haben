/**
 * Rohformen des Accountable-Exports (Stand November 2026).
 *
 * Ein Export besteht aus drei ZIPs je Geschäftsjahr. Für den Umzug zählt nur das dritte
 * (`Accountable_<Name>_skr03_<Datum>_…zip`, der DATEV-Export mit Originaldokumenten): es enthält den DATEV-Buchungsstapel, `Belege.zip` mit `document.xml`,
 * die Belegdateien unter `PDF/Einkäufe` und `PDF/Umsätze` sowie `Daten.xlsx` mit den Angaben,
 * die im Stapel fehlen.
 */

import type { ExpenseCategory } from "@haben/core";

/** Eine Belegdatei aus dem Export, verknüpft über die GUID aus `document.xml` */
export interface AccountableReceipt {
  /** GUID aus `document.xml`; die Buchung verweist mit `BEDI "<guid>"` darauf */
  guid: string;
  /** Dateiname in `Belege.zip`; weicht vom Namen im PDF-Ordner ab (`_012` gegen `_Wdn`) */
  name: string;
  bytes: Uint8Array;
}

/** Eine Buchung, aufbereitet für die Übernahme als Beleg */
export interface AccountableVoucher {
  /** Belegfeld 1: echte Nummer bei Ausgangsrechnungen, sonst `TTMMJJJJ_<Cent>` */
  invoiceNumber: string;
  /** JJJJ-MM-TT */
  documentDate: string;
  supplierName: string | null;
  /** Gegenkonto des Stapels, also das Aufwandskonto */
  account: string;
  /** Bruttobetrag in Cent; bei BU-Schlüssel ist der Umsatz brutto */
  gross: number;
  net: number;
  tax: number;
  /** Basispunkte: 1900 = 19 %, 700 = 7 %, 0 = ohne Steuerautomatik */
  taxRate: number;
  /** GUID des Belegs, falls die Buchung einen Beleglink hat */
  guid: string | null;
  text: string;
  /** Zeile im Stapel, für Verweise auf das Original */
  row: number;
  /**
   * Kategorie aus dem Buchungscode der `Daten.xlsx` (oder aus dem Gegenkonto 0480/0490, wenn die
   * Buchung dort keine Zeile hat); null, wenn beides nichts hergibt. Unbekannte Codes enden als
   * `sonstiges`.
   */
  category: ExpenseCategory | null;
  /** Spalte Q „Bezahlt“; ohne `Daten.xlsx` true, weil der Stapel zahlungsbasiert ist */
  paid: boolean;
  /** Spalte R „Zahlungsdatum“ als JJJJ-MM-TT; null, wenn keins dasteht */
  paidDate: string | null;
  /** Spalte Y „Dokument Vorhanden“; null, wenn die Zeile es nicht sagt */
  documentPresent: boolean | null;
  /** Zeile im Sheet „Ausgaben“ der `Daten.xlsx`; null, wenn die Buchung nicht zugeordnet ist */
  expenseRow: number | null;
}

/**
 * Eine Zeile aus `Daten.xlsx`, Sheet „Ausgaben“. Dort stehen die Angaben, die im DATEV-Stapel
 * fehlen; die Spaltenbuchstaben sind die des Exports:
 *
 * A Buchungsdatum · C Name Des Lieferanten · E Gesamtbetrag · F Betrag Ohne USt. ·
 * G USt.-Betrag · H Währung · J USt.-Satz · M Buchungscode · N Codebeschreibung ·
 * Q Bezahlt · R Zahlungsdatum · Y Dokument Vorhanden
 */
export interface AccountableExpenseRow {
  /** A, JJJJ-MM-TT */
  bookingDate: string | null;
  /** C */
  supplierName: string | null;
  /** E in Cent; null, wenn die Zelle leer ist (etwa bei Fremdwährung ohne Eurobetrag) */
  gross: number | null;
  /** F in Cent */
  net: number | null;
  /** G in Cent */
  tax: number | null;
  /** H; leer heißt Euro. Beträge in anderer Währung sind nicht die des Stapels */
  currency: string;
  /** J in Basispunkten: 1900 = 19 % */
  taxRate: number | null;
  /** M; führende Nullen bleiben erhalten („0490“) */
  code: string;
  /** N */
  codeName: string;
  /** Q */
  paid: boolean | null;
  /** R, JJJJ-MM-TT */
  paidDate: string | null;
  /** Y */
  documentPresent: boolean | null;
  /** Zeile im Sheet, 1-basiert wie dort; die Kopfzeile ist Zeile 1 */
  row: number;
}

/** Eine Ausgangsrechnung aus dem Stapel; Positionen liefert der Export nicht */
export interface AccountableInvoice {
  number: string;
  documentDate: string;
  gross: number;
  text: string;
  row: number;
}
