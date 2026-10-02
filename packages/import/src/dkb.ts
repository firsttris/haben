import type { Cents } from "@haben/core";
import { applyStatedBalance, finish, indexed, optional, optionalReference, pendingWarning, requireAmount, type Tx } from "./common.ts";
import { isBlankRow } from "./csv.ts";
import { Columns } from "./table.ts";
import { normalizeIban, normalizeText, parseDate, parseGermanAmount, requireDate } from "./text.ts";
import type { ParsedStatement } from "./types.ts";

export function isDkbHeader(c: Columns): boolean {
  return c.has("buchungsdatum") && c.has("zahlungspflichtig") && c.has("zahlungsempf") && c.has("betrag");
}

export function isDkbAltHeader(c: Columns): boolean {
  return c.has("buchungstag") && c.has("auftraggeberbegünstigter") && c.has("betrag");
}

interface Header {
  accountIban?: string;
  accountName?: string;
  stated?: { date: string; amount: Cents };
  periodFrom?: string;
  periodTo?: string;
}

/** Kopfzeilen vor der Tabelle, in beiden DKB-Varianten. */
function readHeader(rows: string[][]): Header {
  const header: Header = {};
  for (const row of rows) {
    const key = (row[0] ?? "").trim();
    const value = (row[1] ?? "").trim();
    if (key === "" || value === "") continue;
    const balance = /^Kontostand vom (\S+?):?$/i.exec(key);
    const range = /^(\d{1,2}\.\d{1,2}\.\d{2,4})\s*-\s*(\d{1,2}\.\d{1,2}\.\d{2,4})$/.exec(value);
    if (balance) {
      const date = parseDate(balance[1]!);
      const amount = parseGermanAmount(value);
      if (date && amount !== null) header.stated = { date, amount };
    } else if (/^Kontonummer:?$/i.test(key)) {
      // "DE12120300001234567890 / Girokonto"
      const [iban = "", ...name] = value.split("/");
      header.accountIban = normalizeIban(iban);
      header.accountName = optional(normalizeText(name.join("/")));
    } else if (/^Von:?$/i.test(key)) {
      header.periodFrom = parseDate(value) ?? undefined;
    } else if (/^Bis:?$/i.test(key)) {
      header.periodTo = parseDate(value) ?? undefined;
    } else if (/^Zeitraum:?$/i.test(key) && range) {
      header.periodFrom = parseDate(range[1]!) ?? undefined;
      header.periodTo = parseDate(range[2]!) ?? undefined;
    } else if (header.accountIban === undefined && normalizeIban(value)) {
      // Neues Format: "Girokonto";"DE12 1203 0000 1234 5678 90"
      header.accountIban = normalizeIban(value);
      header.accountName = optional(normalizeText(key));
    }
  }
  return header;
}

function statementFrom(format: ParsedStatement["format"], header: Header): ParsedStatement {
  return {
    format,
    accountIban: header.accountIban,
    accountName: header.accountName,
    currency: "EUR",
    periodFrom: header.periodFrom,
    periodTo: header.periodTo,
    transactions: [],
    warnings: [],
  };
}

/** DKB-Export seit 2023. */
export function parseDkb(rows: string[][], headerRow: number): ParsedStatement {
  const header = readHeader(rows.slice(0, headerRow));
  const c = new Columns(rows[headerRow]!);
  const bookingDate = c.getter("buchungsdatum");
  const valueDate = c.getter("wertstellung");
  const status = c.getter("status");
  const payer = c.getter("zahlungspflichtig");
  const payee = c.getter("zahlungsempf");
  const purpose = c.getter("verwendungszweck");
  const kind = c.getter("umsatztyp");
  const iban = c.getter("iban");
  const amount = c.getter("betrag");
  const creditorId = c.getter("gläubigerid");
  const mandate = c.getter("mandatsreferenz");
  const reference = c.getter("kundenreferenz");

  const list: Tx[] = [];
  let pending = 0;
  rows.slice(headerRow + 1).forEach((row, i) => {
    if (isBlankRow(row)) return;
    const where = `Zeile ${headerRow + i + 2}`;
    if (/^vorgemerkt$/i.test(status(row))) {
      pending++;
      return;
    }
    const cents = requireAmount(parseGermanAmount(amount(row)), amount(row), where);
    const type = kind(row);
    const incoming = /^eingang$/i.test(type) || (!/^ausgang$/i.test(type) && cents > 0);
    list.push({
      bookingDate: requireDate(bookingDate(row), where),
      valueDate: parseDate(valueDate(row)) ?? undefined,
      amount: cents,
      currency: "EUR",
      counterpartyName: normalizeText(incoming ? payer(row) : payee(row)),
      counterpartyIban: normalizeIban(iban(row)),
      purpose: normalizeText(purpose(row)),
      type: optional(type),
      bankReference: optionalReference(reference(row)),
      creditorId: optional(creditorId(row)),
      mandateReference: optional(mandate(row)),
    });
  });

  const statement = statementFrom("dkb-csv", header);
  statement.transactions = indexed(list);
  statement.warnings.push(...pendingWarning(pending));
  applyStatedBalance(statement, header.stated);
  return finish(statement);
}

/** DKB-Export bis 2023 (Latin-1, Kopf mit Kontonummer, Von, Bis). */
export function parseDkbAlt(rows: string[][], headerRow: number): ParsedStatement {
  const header = readHeader(rows.slice(0, headerRow));
  const c = new Columns(rows[headerRow]!);
  const bookingDate = c.getter("buchungstag");
  const valueDate = c.getter("wertstellung");
  const text = c.getter("buchungstext");
  const party = c.getter("auftraggeberbegünstigter");
  const purpose = c.getter("verwendungszweck");
  const account = c.getter("kontonummer", "iban");
  const amount = c.getter("betrag");
  const creditorId = c.getter("gläubigerid");
  const mandate = c.getter("mandatsreferenz");
  const reference = c.getter("kundenreferenz");

  const list: Tx[] = [];
  rows.slice(headerRow + 1).forEach((row, i) => {
    if (isBlankRow(row)) return;
    const where = `Zeile ${headerRow + i + 2}`;
    list.push({
      bookingDate: requireDate(bookingDate(row), where),
      valueDate: parseDate(valueDate(row)) ?? undefined,
      amount: requireAmount(parseGermanAmount(amount(row)), amount(row), where),
      currency: "EUR",
      counterpartyName: normalizeText(party(row)),
      counterpartyIban: normalizeIban(account(row)),
      purpose: normalizeText(purpose(row)),
      type: optional(normalizeText(text(row))),
      bankReference: optionalReference(reference(row)),
      creditorId: optional(creditorId(row)),
      mandateReference: optional(mandate(row)),
    });
  });

  const statement = statementFrom("dkb-csv-alt", header);
  statement.transactions = indexed(list);
  applyStatedBalance(statement, header.stated);
  return finish(statement);
}
