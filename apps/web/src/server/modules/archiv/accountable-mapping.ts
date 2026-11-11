import type { AccountableReceipt, AccountableVoucher } from "@haben/import";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@haben/core";
import type { LegacyCategoryRow, LegacyPayment } from "../../db/schema.ts";
import { sniff } from "../../storage.ts";

/** Jede Buchung aus Accountable beginnt so; kollidiert nicht mit den Kennungen von Lexoffice und sevDesk. */
const ID_PREFIX = "accountable/";

/** So heißt die Quelle in Meldungen an den Beleg. */
export const SOURCE_LABEL = "Accountable";

/** Kennung einer Buchung im Archiv: die Beleg-GUID, ersatzweise die Zeile im Stapel. */
export function externalId(voucher: AccountableVoucher): string {
  return `${ID_PREFIX}${voucher.guid ?? `row/${voucher.row}`}`;
}

/**
 * Aufwandskonto aus dem Stapel auf die Kategorie von Haben. Sie steuert EÜR und Anlagen; gebucht wird nach der
 * Maßgeblichkeit von Haben, gesperrt ist der Betrag aus dem Stapel.
 */
const CATEGORY_BY_ACCOUNT: Record<string, ExpenseCategory> = {
  "4806": "edv",
  "4964": "software",
  "4930": "buero",
  "4980": "betriebsbedarf",
  "4920": "telefon",
  "4925": "internet",
  "4210": "miete",
  "4970": "geldverkehr",
  "4950": "beratung",
  "4955": "buchfuehrung",
  "4360": "versicherung",
  "4380": "beitraege",
  "4673": "fahrtkosten",
  "4676": "uebernachtung",
  "4910": "porto",
  "4600": "werbung",
  "4945": "fortbildung",
  "4940": "literatur",
  "4805": "reparatur",
  "3200": "wareneinkauf",
  "3100": "fremdleistung",
};

/** Aus dem Buchungstext grob ableiten, wenn das Konto unbekannt ist (wie legacy-open.ts für Lexoffice) */
const CATEGORY_HINTS: [RegExp, ExpenseCategory][] = [
  [/bewirtung/i, "bewirtung"],
  // Nur abziehbare Geschenke; „Geschenke über 50 €“ bzw. „nicht abzugsfähig“ fallen nicht darunter
  [/^(?!.*(über|nicht abz)).*geschenk/i, "geschenke"],
  [/software|lizenz/i, "software"],
  [/hosting|server|cloud|edv|it-/i, "edv"],
  [/hardware|gwg|geringwertig/i, "hardware"],
  [/telefon|mobilfunk/i, "telefon"],
  [/internet/i, "internet"],
  [/büro|buero/i, "buero"],
  [/literatur|zeitschrift|bücher/i, "literatur"],
  [/fortbildung|seminar|weiterbildung/i, "fortbildung"],
  [/übernachtung|hotel/i, "uebernachtung"],
  [/reise|fahrt|bahn|taxi/i, "fahrtkosten"],
  [/porto|versand/i, "porto"],
  [/werbung|marketing/i, "werbung"],
  [/buchführung|buchhaltung|steuerberat/i, "buchfuehrung"],
  [/beratung|rechts/i, "beratung"],
  [/wareneingang|wareneinkauf|handelsware/i, "wareneinkauf"],
  [/fremdleistung|subunternehm/i, "fremdleistung"],
  [/kontoführung|gebühr|nebenkosten des geldverkehrs/i, "geldverkehr"],
  [/versicherung/i, "versicherung"],
  [/beitr/i, "beitraege"],
];

export function categoryFor(voucher: AccountableVoucher): ExpenseCategory {
  // Daten.xlsx nennt die Kategorie zum Buchungscode; Gegenkonto und Text sind nur die Notlösung
  if (voucher.category) return voucher.category;
  const category = CATEGORY_BY_ACCOUNT[voucher.account] ?? CATEGORY_HINTS.find(([pattern]) => pattern.test(voucher.text))?.[1] ?? "sonstiges";
  return category in EXPENSE_CATEGORIES ? category : "sonstiges";
}

/**
 * Kategorie wie sie in lexoffice_vouchers.categories steht: `categoryId` ist der Schlüssel aus
 * EXPENSE_CATEGORIES, `name` die Bezeichnung daraus. Auswertungen lesen den Namen (EÜR, UStVA,
 * Journal); eine Kontonummer an dieser Stelle fände dort nichts.
 */
export function categoryRow(voucher: AccountableVoucher): LegacyCategoryRow[] {
  const category = categoryFor(voucher);
  return [{ categoryId: category, name: EXPENSE_CATEGORIES[category].label, rate: voucher.taxRate, net: voucher.net, tax: voucher.tax }];
}

/**
 * Zahlungsstatus aus `Daten.xlsx` (Spalte Q „Bezahlt“, R „Zahlungsdatum“). Offen heißt: brutto
 * steht noch aus. Fehlt die Datei, gilt der Beleg als bezahlt, weil der Stapel zahlungsbasiert
 * über 1200 bucht und dieses Journal keine offenen Verbindlichkeiten kennt.
 */
export function paymentOf(voucher: AccountableVoucher): LegacyPayment {
  if (!voucher.paid) return { status: "open", openAmount: voucher.gross, paidDate: null, items: [] };
  return { status: "paid", openAmount: 0, paidDate: voucher.paidDate ?? voucher.documentDate, items: [] };
}

/** Dateityp am Inhalt; Accountable liefert PDFs, gelegentlich Bilder. */
export function mimeTypeOf(receipt: AccountableReceipt): string {
  const kind = sniff(receipt.bytes)?.kind;
  if (kind === "jpeg") return "image/jpeg";
  if (kind === "png") return "image/png";
  if (kind === "xml") return "application/xml";
  if (kind === "pdf") return "application/pdf";
  return "application/octet-stream";
}

/** Dateiname aus dem Export; ein unbrauchbarer Name bekommt die Belegnummer. */
export function receiptFilename(receipt: AccountableReceipt, voucher: AccountableVoucher | null): string {
  const name = receipt.name.split("/").pop()?.trim() ?? "";
  if (name && !name.startsWith(".")) return name.slice(0, 200);
  const base = (voucher?.invoiceNumber || receipt.guid).replace(/[^\w.-]+/g, "_");
  const kind = sniff(receipt.bytes)?.kind ?? "pdf";
  return `${base}.${kind === "jpeg" ? "jpg" : kind}`.slice(0, 200);
}

/** 1900, 700, 0 — was Haben an Steuersätzen kennt; alles andere wäre geraten. */
function knownTaxRate(rate: number): boolean {
  return rate === 1900 || rate === 700 || rate === 0;
}

/** Warum eine Buchung keinen Beleg in documents bekommt; null heißt: Beleg anlegen. */
export function documentBlocker(voucher: AccountableVoucher, receipt: AccountableReceipt | undefined): string | null {
  if (!receipt) return voucher.guid ? "Belegdatei fehlt im Export" : "Buchung ohne Beleglink";
  // Der Mapper setzt bei diesen BU-Schlüsseln die Steuer auf 0, obwohl der Umsatz brutto ist: nicht raten
  if (voucher.tax > 0 && !knownTaxRate(voucher.taxRate)) return `Steuersatz ${voucher.taxRate / 100} % kennt Haben nicht`;
  if (voucher.gross > 0 && voucher.net + voucher.tax !== voucher.gross) return "Netto und Steuer ergeben nicht den Bruttobetrag";
  return null;
}
