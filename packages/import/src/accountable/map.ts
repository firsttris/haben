import type { ExpenseCategory } from "@haben/core";
import { BU_RATES, type DatevBooking } from "../datev.ts";
import type { AccountableExport } from "./source.ts";
import type { AccountableExpenseRow, AccountableInvoice, AccountableVoucher } from "./types.ts";

/**
 * Konten, die im Accountable-Stapel keine Belege sind:
 *
 * - `1801` Privatentnahmen allgemein (privater Anteil von Miete, Strom, Anschaffungen)
 * - `1890` Privat (Einlagen/Entnahmen des Inhabers)
 * - `1360` Umbuchungen zwischen Unterkonten des Kontos 1200
 *
 * Diese Zeilen bleiben Zahlungen ohne Beleg; der Umzug zählt sie und legt nichts an.
 */
export const ACCOUNTABLE_PRIVATE_ACCOUNTS: ReadonlySet<string> = new Set([
  "1800", // Privatentnahmen (allgemein)
  "1801", // Privatentnahmen des Inhabers
  "1890", // Privateinlagen/Entnahmen
  "1360", // Umbuchungen zwischen Unterkonten des Kontos 1200
]);

/**
 * Dieselben Zeilen im SKR04 (packages/core/src/posting.ts): Privatentnahmen 2100–2199, Privateinlagen 2180, Geldtransit
 * 1460. Dort ist 1800 die Bank und kein Privatkonto.
 */
const ACCOUNTABLE_PRIVATE_ACCOUNTS_SKR04 = /^(21[0-9]{2}|1460)$/;

/** Privat- oder Umbuchungszeile im Kontenrahmen des Exports */
export function isAccountablePrivateAccount(account: string, kontenrahmen: "SKR03" | "SKR04"): boolean {
  return kontenrahmen === "SKR04" ? ACCOUNTABLE_PRIVATE_ACCOUNTS_SKR04.test(account) : ACCOUNTABLE_PRIVATE_ACCOUNTS.has(account);
}

/**
 * BU-Schlüssel, die Haben nicht kennt. `506` steht im Export bei steuerfreien Kleinbeträgen
 * (etwa Bitwarden über 10,00 €), `19` offenbar als Steuersatz statt als Schlüssel. Beide werden
 * ohne Steueranteil übernommen und als Hinweis gemeldet — raten wäre hier falsch.
 */
export const ACCOUNTABLE_UNKNOWN_BU_KEYS: ReadonlySet<string> = new Set(["506", "19"]);

/**
 * Buchungscodes aus `Daten.xlsx` (Spalte M) auf die Kategorien von Haben. Accountable sortiert
 * feiner als der Kontenrahmen; wo Haben keine eigene Kategorie hat, steht der nächste Topf dabei:
 *
 * - `0420` Büroeinrichtung: Möbel und Ausstattung. Haben hat keine eigene Kategorie dafür;
 *   `buero` ist der Büro-Topf, `hardware` würde Büromöbel als EDV ausgeben, `anlage` würde
 *   abschreiben, was hier als Aufwand gebucht ist.
 * - `4280` Dekoration (im Export 2026 eine Position vom Baumarkt): ebenfalls `buero`, weil es
 *   Ausstattung fürs Büro ist und kein Raumkostenanteil wie `4288`.
 * - `4288` Miete und Nebenkosten des häuslichen Arbeitsplatzes: `miete` ist der einzige
 *   Raumkosten-Topf; eine eigene Kategorie fürs Arbeitszimmer gibt es nicht.
 * - `4910` Briefmarken & Porto und `4970` Bankgebühren heißen in Haben `porto` und `geldverkehr`.
 *
 * `0490` Elektronik/IT steht hier nicht: ob das Gerät ein GWG oder ein Anlagegut ist, entscheidet
 * der Netto-Betrag — siehe `categoryForCode`. Unbekannte Codes werden nicht geraten: sie enden
 * als `sonstiges` und stehen als Hinweis am Lauf.
 */
export const ACCOUNTABLE_CATEGORY_BY_CODE: Readonly<Record<string, ExpenseCategory>> = {
  "0420": "buero", // Büroeinrichtung: kein eigener Topf, nächster ist Bürobedarf
  "4280": "buero", // Dekoration fürs Büro
  "4288": "miete", // Miete/Nebenkosten häusliches Arbeitszimmer
  "4670": "fahrtkosten", // Öffentliche Verkehrsmittel
  "4806": "edv", // Hosting
  "4909": "fremdleistung", // Fremdleistungen
  "4910": "porto", // Briefmarken & Porto
  "4920": "telefon", // Telefon
  "4925": "internet", // Internet
  "4930": "buero", // Büromaterial
  "4964": "software", // Software-Abo
  "4970": "geldverkehr", // Bankgebühren
};

/** Grenze für geringwertige Wirtschaftsgüter (§ 6 Abs. 2 EStG): bis 800 € netto sofort Aufwand */
export const GWG_LIMIT = 800_00;

/**
 * Kategorie zu einem Buchungscode; null heißt, Haben kennt den Code nicht.
 *
 * `0490` Elektronik/IT hängt am Netto-Betrag: bis 800 € netto ist das Gerät ein GWG (`hardware`,
 * SKR03 0480), darüber ein Anlagegut (`anlage`, SKR03 0490), das abgeschrieben wird. Beides sind
 * verschiedene Zeilen in EÜR und Bilanz, deshalb wird hier nicht pauschal `hardware` gesetzt.
 */
export function categoryForCode(code: string, net: number): ExpenseCategory | null {
  // 0480 ist das GWG-Konto, dort steht nie ein Anlagegut
  if (code === "0480") return "hardware";
  if (code === "0490") return net > GWG_LIMIT ? "anlage" : "hardware";
  return ACCOUNTABLE_CATEGORY_BY_CODE[code] ?? null;
}

/**
 * Gegenkonten für Geräte. Fehlt die Buchung in `Daten.xlsx`, sagt das Konto noch, dass es ein
 * Gerät ist; Accountable nutzt dieselbe Nummer als Buchungscode. `0480` ist immer ein GWG,
 * `0490` entscheidet der Netto-Betrag — dieselbe Regel wie oben.
 */
const EQUIPMENT_ACCOUNTS: ReadonlySet<string> = new Set(["0480", "0490"]);

/** „BEDI \"7c2aee35-…\"“ → GUID */
export const guidFromLink = (link: string): string | null => /BEDI\s+"([^"]+)"/.exec(link)?.[1] ?? null;

/** „ER Bitwarden Inc." → „Bitwarden Inc." */
export function supplierFromText(text: string): string | null {
  const trimmed = text
    .trim()
    .replace(/^(ER|AR|EB|AB)\s+/i, "")
    .trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Cent aus einem DATEV-Betrag; der Leser liefert bereits Cent */
export function taxFromGross(gross: number, rate: number): { net: number; tax: number } {
  const tax = Math.round((gross * rate) / (10000 + rate));
  return { net: gross - tax, tax };
}

export interface AccountableMapping {
  vouchers: AccountableVoucher[];
  /** Ausgangsrechnungen; Positionen liefert der Export nicht, sie werden nur gemeldet */
  invoices: AccountableInvoice[];
  /** Zeilen ohne Beleg: privat, Umbuchung, Steuerkonto */
  privateRows: number;
  /** Buchungen mit Beleglink, deren GUID im Export fehlt */
  missingReceipts: number;
  /** Zeilen mit unbekanntem BU-Schlüssel (ACCOUNTABLE_UNKNOWN_BU_KEYS): ohne Steueranteil, nicht raten */
  unknownTaxRows: number;
  /** Hinweise aus der Zuordnung, etwa ein Buchungscode, den Haben nicht kennt */
  warnings: string[];
}

/**
 * Bildet die Buchungen des Stapels auf Belege ab.
 *
 * Accountable bucht jede Ausgabe einzeln gegen das Bankkonto 1200, Gegenkonto ist das
 * Aufwandskonto. Bei gesetztem BU-Schlüssel ist der Umsatz **brutto**; Steuer und Netto werden
 * daraus gerechnet. Ausgangsrechnungen (`S` auf 1200 gegen ein Erlöskonto) werden getrennt
 * geführt: Haben verlangt für eine Rechnung Positionen, die der DATEV-Stapel nicht enthält.
 *
 * Zu jeder Buchung wird die Zeile aus `Daten.xlsx` gesucht — über Belegfeld 1 (`TTMMJJJJ_<Cent>`),
 * sonst über Datum und Betrag. Von dort kommen Kategorie, Lieferantenname, Zahlungsstatus und die
 * Beträge, wenn der Stapel sie nicht trägt.
 */
export function mapAccountableExport(exp: AccountableExport): AccountableMapping {
  const vouchers: AccountableVoucher[] = [];
  const invoices: AccountableInvoice[] = [];
  const unknownCodes = new Set<string>();
  const ambiguous: string[] = [];
  const book = expenseBook(exp.expenses);
  let privateRows = 0;
  let missingReceipts = 0;
  let unknownTaxRows = 0;

  for (const booking of exp.stack.bookings) {
    // Vor der Seite prüfen: Eine Privateinlage steht wie ein Erlös im Soll der Bank, ist aber keine Rechnung
    if (isAccountablePrivateAccount(booking.contraAccount.trim(), exp.kontenrahmen)) {
      privateRows += 1;
      continue;
    }

    if (booking.side === "S") {
      invoices.push({
        number: booking.voucherField1,
        documentDate: booking.date,
        gross: booking.amount,
        text: booking.text,
        row: booking.row,
      });
      continue;
    }

    const guid = guidFromLink(booking.documentLink);
    if (guid && !exp.receiptByGuid.has(guid)) missingReceipts += 1;

    if (ACCOUNTABLE_UNKNOWN_BU_KEYS.has(booking.buKey.trim())) unknownTaxRows += 1;
    const hit = expenseFor(book, booking);
    if (hit.ambiguous > 1) {
      // Datum und Betrag passen auf mehrere Zeilen: nicht raten, der Stapel bleibt die Quelle
      ambiguous.push(`${booking.date} über ${euro(booking.amount)}: ${hit.ambiguous} Zeilen in Daten.xlsx passen auf Datum und Betrag`);
    }
    vouchers.push(mapVoucher(booking, guid, hit.row, unknownCodes));
  }

  const warnings = [...unknownCodes].sort().map((code) => `Buchungscode ${code} aus Daten.xlsx kennt Haben nicht; als „Sonstiger Aufwand“ übernommen.`);
  for (const case_ of ambiguous) warnings.push(`Buchung vom ${case_} — ohne Angaben aus Daten.xlsx übernommen.`);

  return { vouchers, invoices, privateRows, missingReceipts, unknownTaxRows, warnings };
}

/** 1234 → „12,34 €“ für Hinweise */
const euro = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;

/** Zeilen aus `Daten.xlsx`, nachschlagbar über Belegfeld 1 und ersatzweise über Datum und Betrag */
function expenseBook(rows: AccountableExpenseRow[]) {
  const byNumber = new Map<string, AccountableExpenseRow>();
  const byDateAmount = new Map<string, AccountableExpenseRow[]>();
  for (const row of rows) {
    const number = expenseNumber(row);
    if (number && !byNumber.has(number)) byNumber.set(number, row);
    if (!row.bookingDate || row.gross === null) continue;
    // Mehrere Zeilen mit demselben Datum und Betrag bleiben als Liste stehen: der Rückfall darf
    // nur greifen, wenn genau eine Zeile passt
    const fallback = `${row.bookingDate}|${row.gross}`;
    byDateAmount.set(fallback, [...(byDateAmount.get(fallback) ?? []), row]);
  }
  return { byNumber, byDateAmount };
}

/**
 * Die Zeile zu einer Buchung: zuerst über Belegfeld 1, sonst über Datum und Betrag. `ambiguous`
 * zählt die Zeilen, wenn Datum und Betrag auf mehrere passen — dann bleibt die Buchung ohne
 * Zeile, denn welche gemeint ist, weiß nur der Stapel.
 */
function expenseFor(book: ReturnType<typeof expenseBook>, booking: DatevBooking): { row: AccountableExpenseRow | null; ambiguous: number } {
  const exact = book.byNumber.get(booking.voucherField1.trim());
  if (exact) return { row: exact, ambiguous: 0 };
  const candidates = book.byDateAmount.get(`${booking.date}|${booking.amount}`) ?? [];
  return candidates.length === 1 ? { row: candidates[0]!, ambiguous: 0 } : { row: null, ambiguous: candidates.length };
}

/** Belegfeld-1-Form einer Zeile: `06012025_9281`; null, wenn Datum oder Betrag fehlt */
function expenseNumber(row: AccountableExpenseRow): string | null {
  const [year, month, day] = (row.bookingDate ?? "").split("-");
  if (!year || !month || !day || row.gross === null) return null;
  return `${day}${month}${year}_${row.gross}`;
}

function mapVoucher(booking: DatevBooking, guid: string | null, expense: AccountableExpenseRow | null, unknownCodes: Set<string>): AccountableVoucher {
  const buKey = booking.buKey.trim();
  const percent = BU_RATES[buKey] ?? 0;
  const bookedRate = ACCOUNTABLE_UNKNOWN_BU_KEYS.has(buKey) ? 0 : percent * 100;
  const derived = bookedRate > 0 ? taxFromGross(booking.amount, bookedRate) : { net: booking.amount, tax: 0 };
  const amounts = rowAmounts(expense) ?? { gross: booking.amount, net: derived.net, tax: derived.tax, taxRate: bookedRate };
  const account = booking.contraAccount.trim();
  const code = expense?.code ?? "";
  // Ohne Zeile in Daten.xlsx bleibt das Gegenkonto: 0480/0490 sagen, dass es ein Gerät ist
  const key = code || (EQUIPMENT_ACCOUNTS.has(account) ? account : "");
  const known = key ? categoryForCode(key, amounts.net) : null;
  if (code && !known) unknownCodes.add(code);
  return {
    invoiceNumber: booking.voucherField1,
    documentDate: booking.date,
    supplierName: expense?.supplierName ?? supplierFromText(booking.text),
    account,
    ...amounts,
    guid,
    text: booking.text,
    row: booking.row,
    category: known ?? (code ? "sonstiges" : null),
    // Ohne Daten.xlsx gilt die Buchung als bezahlt: der Stapel bucht zahlungsbasiert über 1200
    paid: expense?.paid ?? true,
    paidDate: expense?.paidDate ?? null,
    documentPresent: expense?.documentPresent ?? null,
    expenseRow: expense?.row ?? null,
  };
}

/**
 * Beträge aus der Zeile, sofern sie vollständig, in sich stimmig und in Euro sind.
 *
 * Der Stapel bucht in Euro; eine Zeile in Fremdwährung (etwa 10 USD bei Bitwarden) würde sonst
 * Dollar als Euro einsetzen. Ohne Steuersatz lässt sich nur ein steuerfreier Betrag übernehmen —
 * sonst bleibt der Betrag aus dem BU-Schlüssel, weil Haben den Satz nicht raten darf.
 */
function rowAmounts(expense: AccountableExpenseRow | null): Pick<AccountableVoucher, "gross" | "net" | "tax" | "taxRate"> | null {
  if (!expense) return null;
  if (expense.currency !== "" && expense.currency !== "EUR") return null;
  const { gross, net, tax, taxRate } = expense;
  if (gross === null || net === null || tax === null) return null;
  if (net + tax !== gross) return null;
  if (taxRate === null && tax !== 0) return null;
  return { gross, net, tax, taxRate: taxRate ?? 0 };
}
