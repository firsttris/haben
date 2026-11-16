import type { Cents } from "@haben/core";
import { finish, indexed, optional, optionalReference, requireAmount, type Tx } from "./common.ts";
import { isBlankRow } from "./csv.ts";
import { Columns } from "./table.ts";
import { normalizeHeader, normalizeIban, normalizeText, parseDate, parseGermanAmount, requireDate } from "./text.ts";
import type { ParsedStatement } from "./types.ts";

/*
 * ING exportiert die Umsatzanzeige als Semikolon-CSV in Windows-1252 (#1161): ein Kopfblock mit IBAN, Kontoname,
 * Bank, Kunde, Zeitraum und Saldo, bei einer Suche die Zeile „Filter“, dann die Tabelle Buchung, Wertstellungsdatum,
 * Auftraggeber/Empfänger, Buchungstext, Verwendungszweck, Referenz, Saldo, Währung, Betrag, Währung. Die erste
 * „Währung“ gehört zum Saldo, die zweite zum Betrag. Vorgemerkte Umsätze stehen nicht in der Datei, die IBAN der
 * Gegenseite auch nicht.
 *
 * Salden kommen aus der Spalte „Saldo“ (Kontostand nach jeder Buchung), nicht aus dem Kopf: Dessen Saldo gilt fürs
 * ganze Konto, auch wenn der Export gefiltert ist. Bei einer Suche fehlen Umsätze dazwischen; dann übernimmt Haben
 * nur die enthaltenen Umsätze und keine Salden.
 */
export function isIngHeader(c: Columns): boolean {
  return c.has("auftraggeberempfänger") && c.has("buchungstext") && c.has("saldo") && c.has("betrag");
}

interface Header {
  accountIban?: string;
  accountName?: string;
  periodFrom?: string;
  periodTo?: string;
  filter?: string;
}

function readHeader(rows: string[][]): Header {
  const header: Header = {};
  for (const row of rows) {
    const key = normalizeHeader(row[0] ?? "");
    const value = normalizeText(row[1]);
    if (value === "") continue;
    if (key === "iban") header.accountIban = normalizeIban(value);
    else if (key === "kontoname") header.accountName = value;
    else if (key === "filter") header.filter = value;
    else if (key === "zeitraum") {
      const [from = "", to = ""] = value.split(/\s+-\s+/);
      header.periodFrom = parseDate(from) ?? undefined;
      header.periodTo = parseDate(to) ?? undefined;
    }
  }
  return header;
}

interface Row {
  tx: Tx;
  balance: Cents | null;
}

/** Salden, wenn die Spalte „Saldo“ lückenlos aufgeht; älteste Buchung zuerst, Richtung aus den Buchungstagen. */
function balancesOf(rows: Row[]): { opening: Cents; closing: Cents } | undefined {
  if (rows.length === 0 || rows.some((r) => r.balance === null)) return undefined;
  const first = rows[0]!.tx.bookingDate;
  const last = rows[rows.length - 1]!.tx.bookingDate;
  const reversed = [...rows].reverse();
  // Bei „Datum absteigend“ steht die neueste Buchung oben; nur an einem einzigen Tag sind beide Richtungen möglich.
  // Sonst ginge etwa Lastschrift und Rückgabe auch falsch herum auf (x, −x).
  const orders = first < last ? [rows] : first > last ? [reversed] : [rows, reversed];
  const found = orders
    .filter((o) => o.every((r, i) => i === 0 || o[i - 1]!.balance! + r.tx.amount === r.balance))
    .map((o) => ({ opening: o[0]!.balance! - o[0]!.tx.amount, closing: o[o.length - 1]!.balance! }));
  if (found.length === 0) return undefined;
  if (found.some((f) => f.opening !== found[0]!.opening || f.closing !== found[0]!.closing)) return undefined;
  return found[0];
}

export function parseIng(rows: string[][], headerRow: number): ParsedStatement {
  const header = readHeader(rows.slice(0, headerRow));
  const names = rows[headerRow]!.map(normalizeHeader);
  const c = new Columns(rows[headerRow]!);
  const bookingDate = c.getter("buchung");
  const valueDate = c.getter("wertstellungsdatum", "valuta");
  const party = c.getter("auftraggeberempfänger");
  const kind = c.getter("buchungstext");
  const purpose = c.getter("verwendungszweck");
  const reference = c.getter("referenz");
  const balance = c.getter("saldo");
  const amount = c.getter("betrag");
  // Währung des Betrags steht in der Spalte direkt dahinter
  const amountCurrency = names.indexOf("betrag") + 1;
  const currency = (row: string[]) => (names[amountCurrency] === "währung" ? (row[amountCurrency] ?? "").trim() : "");

  const list: Row[] = [];
  rows.slice(headerRow + 1).forEach((row, i) => {
    if (isBlankRow(row)) return;
    const where = `Zeile ${headerRow + i + 2}`;
    const type = normalizeText(kind(row));
    list.push({
      tx: {
        bookingDate: requireDate(bookingDate(row), where),
        valueDate: parseDate(valueDate(row)) ?? undefined,
        amount: requireAmount(parseGermanAmount(amount(row)), amount(row), where),
        currency: currency(row) || "EUR",
        counterpartyName: normalizeText(party(row)),
        purpose: normalizeText(purpose(row)),
        type: optional(type),
        bankReference: optionalReference(reference(row)),
      },
      balance: parseGermanAmount(balance(row)),
    });
  });

  const statement: ParsedStatement = {
    format: "ing-csv",
    accountIban: header.accountIban,
    accountName: header.accountName,
    currency: "EUR",
    periodFrom: header.periodFrom,
    periodTo: header.periodTo,
    transactions: indexed(list.map((r) => r.tx)),
    warnings: [],
  };
  if (header.filter) {
    statement.warnings.push(`Gefilterter Export (Suche „${header.filter}“): Haben übernimmt nur diese Umsätze und keine Salden.`);
  } else {
    const balances = balancesOf(list);
    if (balances) {
      statement.openingBalance = balances.opening;
      statement.closingBalance = balances.closing;
    } else if (list.length > 0) {
      statement.warnings.push("Die Spalte „Saldo“ geht nicht lückenlos auf; Salden werden nicht übernommen.");
    }
  }
  return finish(statement);
}
