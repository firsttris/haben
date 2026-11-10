import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";
import { parseDatevBuchungsstapel, type DatevStack } from "../datev.ts";
import type { AccountableBankMovement, AccountableExpenseRow, AccountableReceipt, AccountableRevenue } from "./types.ts";
import { readXlsxSheet } from "./xlsx.ts";

/**
 * Liest einen Accountable-DATEV-Export (`Accountable_<Name>_skr03_<Datum>_…zip`) aus dem Speicher.
 *
 * Aufbau des ZIPs: `datev_skr03_<Datum>/EXTF_Buchungsstapel_<Jahr>….csv` (Windows-1252, Kopfzeile,
 * Spaltenzeile, Buchungen), daneben `Belege.zip` mit `document.xml` und den Dateien, außerdem
 * `PDF/Einkäufe`, `PDF/Umsätze`, `Daten.xlsx` und `Abschreibungstabelle.xlsx`.
 *
 * Der Stapel wird vom vorhandenen DATEV-Leser eingelesen; hier kommt nur die Verknüpfung
 * Buchung → Belegdatei dazu. Verknüpft wird über die **GUID**, nie über den Dateinamen: der
 * Name in `Belege.zip` trägt ein anderes Suffix als der im PDF-Ordner.
 *
 * `Daten.xlsx` liefert, was der Stapel nicht kennt: Kategorie (Buchungscode), Lieferantenname,
 * Zahlungsstatus und ob ein Belegdokument vorliegt. Fehlt die Datei, bleibt `expenses` leer; der
 * Import läuft dann mit den Angaben des Stapels weiter.
 */
export interface AccountableExport {
  /** Der eingelesene Buchungsstapel samt Kopfzeile und Warnungen */
  stack: DatevStack;
  /** Belege aus `Belege.zip`, aufgelöst über `document.xml` */
  receipts: AccountableReceipt[];
  /** Schnellzugriff GUID → Beleg */
  receiptByGuid: Map<string, AccountableReceipt>;
  /** Alle Belegdateien des Exports (auch die ohne Buchungsbezug), Schlüssel: Dateiname */
  files: Map<string, Uint8Array>;
  /** Zeilen des Sheets „Ausgaben“ aus `Daten.xlsx`; leer, wenn die Datei fehlt */
  expenses: AccountableExpenseRow[];
  /** Zeilen des Sheets „Kontobewegungen“: die Umsätze des verknüpften Bankkontos */
  bankMovements: AccountableBankMovement[];
  /** Zeilen des Sheets „Rechnungen“: Ausgangsrechnungen und sonstige Einnahmen */
  revenues: AccountableRevenue[];
  /** Was beim Entpacken aufgefallen ist; der Import zeigt es als Hinweis an */
  warnings: string[];
  /** Kontenrahmen des Stapels: aus dem Kopf, sonst aus dem Ordnernamen (`datev_skr04_…`), sonst SKR03 */
  kontenrahmen: "SKR03" | "SKR04";
}

const decoder = new TextDecoder("utf-8");

/** Dateiname ohne Ordner */
const base = (path: string) => path.split("/").pop() ?? path;

/** Spaltenköpfe im Sheet „Ausgaben“; die Buchstaben stehen am Feld in `types.ts` */
const COLUMNS = {
  bookingDate: "Buchungsdatum", // A
  supplierName: "Name Des Lieferanten", // C
  gross: "Gesamtbetrag", // E
  net: "Betrag Ohne USt.", // F
  tax: "USt.-Betrag", // G
  currency: "Währung", // H
  taxRate: "USt.-Satz", // J
  code: "Buchungscode", // M
  codeName: "Codebeschreibung", // N
  paid: "Bezahlt", // Q
  paidDate: "Zahlungsdatum", // R
  documentPresent: "Dokument Vorhanden", // Y
  bankMovement: "Kontobewegungen", // P, der zugehörige Bankumsatz im Klartext
} as const;

/**
 * Die Belegdateien liegen in zwei Namensräumen: in `Belege.zip` flach mit eigenem Suffix,
 * im Export unter `PDF/Einkäufe` und `PDF/Umsätze`. Für die Zuordnung zählt allein die GUID.
 */
export function readAccountableExport(archive: Uint8Array): AccountableExport {
  const warnings: string[] = [];
  const outer = unzipSync(archive);

  const stackName = Object.keys(outer).find((name) => /(^|\/)EXTF.*\.csv$/i.test(name));
  if (!stackName) throw new Error("Kein DATEV-Buchungsstapel (EXTF…csv) im Export gefunden.");

  const stack = parseDatevBuchungsstapel(outer[stackName]!);
  const files = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(outer)) {
    if (/^PDF\//i.test(path) && !path.endsWith("/")) files.set(base(path), bytes);
  }

  const belegeName = Object.keys(outer).find((name) => name.toLowerCase().endsWith("belege.zip"));
  const receipts: AccountableReceipt[] = [];
  if (!belegeName) {
    warnings.push("Belege.zip fehlt; der Umzug übernimmt nur die Buchungen.");
  } else {
    const inner = unzipSync(outer[belegeName]!);
    const xmlName = Object.keys(inner).find((name) => base(name).toLowerCase() === "document.xml");
    if (!xmlName) {
      warnings.push("document.xml fehlt in Belege.zip; Zuordnung Buchung → Beleg nicht möglich.");
    } else {
      const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", removeNSPrefix: true }).parse(decoder.decode(inner[xmlName]!)) as {
        archive?: { content?: { document?: unknown } };
      };
      for (const entry of asArray(parsed.archive?.content?.document)) {
        const guid = text(entry, "guid");
        const name = text(extension(entry), "name");
        if (!guid || !name) continue;
        const bytes = inner[name] ?? inner[Object.keys(inner).find((key) => base(key) === name) ?? ""];
        if (!bytes) {
          warnings.push(`Beleg ${name} steht in document.xml, fehlt aber in Belege.zip.`);
          continue;
        }
        receipts.push({ guid, name, bytes });
      }
    }
  }

  const expenseFile = Object.keys(outer).find((name) => base(name).toLowerCase() === "daten.xlsx");
  const expenses = expenseFile ? expensesOf(outer[expenseFile]!) : [];
  const bankMovements = expenseFile ? bankMovementsOf(outer[expenseFile]!) : [];
  const revenues = expenseFile ? revenuesOf(outer[expenseFile]!) : [];

  const receiptByGuid = new Map(receipts.map((receipt) => [receipt.guid, receipt]));

  // Accountable füllt das Feld Sachkontenrahmen im Kopf nicht; der Ordner trägt ihn (`datev_skr03_…`, `datev_skr04_…`)
  const kontenrahmen =
    stack.header.kontenrahmen === "SKR04" || (stack.header.kontenrahmen === "" && /(^|\/)datev_skr04[_/]/i.test(stackName)) ? "SKR04" : "SKR03";

  return { stack, receipts, receiptByGuid, files, expenses, bankMovements, revenues, warnings, kontenrahmen };
}

/** Die Zeilen des Sheets „Ausgaben“ in die Form, mit der `map.ts` arbeitet */
function expensesOf(xlsx: Uint8Array): AccountableExpenseRow[] {
  return readXlsxSheet(xlsx, "Ausgaben").map((row, index) => ({
    bookingDate: isoDate(row[COLUMNS.bookingDate]),
    supplierName: textOrNull(row[COLUMNS.supplierName]),
    gross: euros(row[COLUMNS.gross]),
    net: euros(row[COLUMNS.net]),
    tax: euros(row[COLUMNS.tax]),
    currency: (row[COLUMNS.currency] ?? "").trim().toUpperCase(),
    taxRate: basisPoints(row[COLUMNS.taxRate]),
    code: normalizeCode(row[COLUMNS.code]),
    codeName: (row[COLUMNS.codeName] ?? "").trim(),
    paid: yesNo(row[COLUMNS.paid]),
    paidDate: isoDate(row[COLUMNS.paidDate]),
    documentPresent: yesNo(row[COLUMNS.documentPresent]),
    bankMovement: textOrNull(row[COLUMNS.bankMovement]),
    // Die Kopfzeile ist Zeile 1, die erste Datenzeile also Zeile 2
    row: index + 2,
  }));
}

/** Spaltenköpfe im Sheet „Kontobewegungen“; die Buchstaben stehen am Feld in `types.ts` */
const MOVEMENT_COLUMNS = {
  date: "Datum Der Kontobewegung", // A
  account: "Kontonummer", // B
  purpose: "Verwendungszweck", // D
  amount: "Betrag", // E
  counterparty: "Name Des Senders/Empfängers", // F
  counterpartyAccount: "Konto Des Senders/Empfängers", // G
  matched: "Beleg Oder Rechnung Zugeordnet?", // H
} as const;

/** Die Zeilen des Sheets „Kontobewegungen“: die Umsätze des Bankkontos, mit Vorzeichen */
function bankMovementsOf(xlsx: Uint8Array): AccountableBankMovement[] {
  return readXlsxSheet(xlsx, "Kontobewegungen").map((row, index) => ({
    date: isoDate(row[MOVEMENT_COLUMNS.date]),
    account: (row[MOVEMENT_COLUMNS.account] ?? "").trim(),
    purpose: (row[MOVEMENT_COLUMNS.purpose] ?? "").trim(),
    amount: signedEuros(row[MOVEMENT_COLUMNS.amount]),
    counterparty: (row[MOVEMENT_COLUMNS.counterparty] ?? "").trim(),
    counterpartyAccount: (row[MOVEMENT_COLUMNS.counterpartyAccount] ?? "").trim(),
    matched: yesNo(row[MOVEMENT_COLUMNS.matched]),
    row: index + 2,
  }));
}

/** Spaltenköpfe im Sheet „Rechnungen“; die Buchstaben stehen am Feld in `types.ts` */
const REVENUE_COLUMNS = {
  number: "Einkommenszahl", // A
  kind: "Rechnung Type", // B
  status: "Status", // C
  invoiceDate: "Rechnungsdatum", // D
  paidDate: "Zahlungsdatum", // G
  customer: "Kundenname", // H
  net: "Betrag Ohne USt.", // I
  tax: "USt.-Betrag", // J
  gross: "Gesamtbetrag", // K
  currency: "Währung", // L
  item: "Name Des Artikels", // M
  taxRate: "USt.-Satz", // P
} as const;

/** Die Zeilen des Sheets „Rechnungen“: Ausgangsrechnungen und sonstige Einnahmen */
function revenuesOf(xlsx: Uint8Array): AccountableRevenue[] {
  return readXlsxSheet(xlsx, "Rechnungen").map((row, index) => ({
    number: (row[REVENUE_COLUMNS.number] ?? "").trim(),
    kind: (row[REVENUE_COLUMNS.kind] ?? "").trim(),
    status: (row[REVENUE_COLUMNS.status] ?? "").trim(),
    invoiceDate: isoDate(row[REVENUE_COLUMNS.invoiceDate]),
    paidDate: isoDate(row[REVENUE_COLUMNS.paidDate]),
    customer: (row[REVENUE_COLUMNS.customer] ?? "").trim(),
    net: euros(row[REVENUE_COLUMNS.net]),
    tax: euros(row[REVENUE_COLUMNS.tax]),
    gross: euros(row[REVENUE_COLUMNS.gross]),
    currency: (row[REVENUE_COLUMNS.currency] ?? "").trim().toUpperCase(),
    item: (row[REVENUE_COLUMNS.item] ?? "").trim(),
    taxRate: basisPoints(row[REVENUE_COLUMNS.taxRate]),
    row: index + 2,
  }));
}

/**
 * Betrag mit Vorzeichen in Cent: „-44.99“ → −4499. `euros` nimmt nur Beträge ohne Vorzeichen,
 * hier ist das Minus die Richtung der Zahlung und darf nicht verloren gehen.
 */
function signedEuros(value: string | undefined): number | null {
  const raw = (value ?? "").trim().replace(/\s/g, "");
  if (raw === "") return null;
  const negative = raw.startsWith("-");
  const amount = euros(raw.replace(/^[+-]/, ""));
  if (amount === null) return null;
  return negative ? -amount : amount;
}

function textOrNull(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** „31.12.2025“ → „2025-12-31“; ISO bleibt, alles andere wird null */
function isoDate(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/** „45,49“ oder „1.234,56“ → Cent; leer → null */
function euros(value: string | undefined): number | null {
  const amount = decimal(value);
  return amount === null ? null : Math.round(amount * 100);
}

/**
 * „0,19“ bzw. „0.19“ → 1900 Basispunkte. Ein Wert über 1 ist schon Prozent (19 → 1900), denn die
 * Spalte ist in der echten Datei ein Bruchteil, in von Hand gepflegten Tabellen aber Prozent.
 */
function basisPoints(value: string | undefined): number | null {
  const rate = decimal(value);
  if (rate === null) return null;
  return Math.round(rate > 1 ? rate * 100 : rate * 10000);
}

function decimal(value: string | undefined): number | null {
  const text = (value ?? "").replace(/[^\d,.-]/g, "").trim();
  if (text === "") return null;
  // Accountable schreibt den Punkt als Dezimaltrennzeichen, deutsche Tabellen den Beistrich
  const number = Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text);
  return Number.isFinite(number) ? number : null;
}

/** Buchungscode als vierstelliger Text; „0490“ behält die führende Null */
function normalizeCode(value: string | undefined): string {
  const text = (value ?? "").trim();
  return /^\d+$/.test(text) ? text.padStart(4, "0") : text;
}

function yesNo(value: string | undefined): boolean | null {
  const text = (value ?? "").trim().toLowerCase();
  if (text === "ja" || text === "yes" || text === "true" || text === "1") return true;
  if (text === "nein" || text === "no" || text === "false" || text === "0") return false;
  return null;
}

/** XML-Parser liefert je nach Anzahl ein Objekt oder eine Liste */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(node: unknown, key: string): string | null {
  if (typeof node !== "object" || node === null) return null;
  const value = (node as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

/** `<extension xsi:type="File" name="…"/>`; nach `removeNSPrefix` heißt die Eigenschaft `extension` */
function extension(document: unknown): unknown {
  if (typeof document !== "object" || document === null) return null;
  const value = (document as Record<string, unknown>).extension;
  return Array.isArray(value) ? value[0] : value;
}
