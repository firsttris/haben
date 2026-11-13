import { finish, indexed, optional, requireAmount, type Tx } from "./common.ts";
import { isBlankRow } from "./csv.ts";
import { StatementParseError } from "./errors.ts";
import { Columns } from "./table.ts";
import { normalizeIban, normalizeText, parseGermanAmount, requireDate } from "./text.ts";
import type { ParsedStatement } from "./types.ts";

/*
 * C24 exportiert die Umsätze eines Kontos oder einer Pocket als Komma-CSV (UTF-8 mit BOM), ohne Kopfblock und ohne
 * Kontostand: Transaktionstyp, Buchungsdatum, Karteneinsatz, Betrag, Zahlungsempfänger, IBAN, BIC, Verwendungszweck,
 * Beschreibung, Kontonummer, Kontoname, Kategorie, Unterkategorie, Bargeldabhebung. Die neueste Zeile steht oben,
 * Beträge deutsch mit Euro-Zeichen, die Datenzeilen sind eine Spalte kürzer als die Kopfzeile.
 *
 * „Zahlungsempfänger“ ist in beiden Richtungen die Gegenseite. Den Verwendungszweck einer Überweisung trägt die Spalte
 * Verwendungszweck, den Händlertext einer Kartenzahlung die Spalte Beschreibung; beide zusammen ergeben den Zweck.
 * Die eigene IBAN nennt die Datei nicht, nur die Kontonummer; Umbuchungen zwischen Pockets haben keine Gegen-IBAN.
 */
export function isC24Header(c: Columns): boolean {
  return c.has("transaktionstyp") && c.has("buchungsdatum") && c.has("zahlungsempfänger") && c.has("kontonummer");
}

export function parseC24(rows: string[][], headerRow: number): ParsedStatement {
  const c = new Columns(rows[headerRow]!);
  const kind = c.getter("transaktionstyp");
  const bookingDate = c.getter("buchungsdatum");
  const amount = c.getter("betrag");
  const name = c.getter("zahlungsempfänger");
  const iban = c.getter("iban");
  const purpose = c.getter("verwendungszweck");
  const description = c.getter("beschreibung");
  const accountNumber = c.getter("kontonummer");
  const accountName = c.getter("kontoname");

  const filled = rows
    .slice(headerRow + 1)
    .map((row, i) => ({ row, where: `Zeile ${headerRow + i + 2}` }))
    .filter(({ row }) => !isBlankRow(row));
  if (new Set(filled.map(({ row }) => accountNumber(row))).size > 1) {
    throw new StatementParseError("Die CSV-Datei enthält Umsätze mehrerer Konten. Bitte je Konto bzw. Pocket eine Datei hochladen.");
  }

  const list: Tx[] = filled.map(({ row, where }) => ({
    bookingDate: requireDate(bookingDate(row), where),
    amount: requireAmount(parseGermanAmount(amount(row)), amount(row), where),
    currency: "EUR",
    counterpartyName: normalizeText(name(row)),
    counterpartyIban: normalizeIban(iban(row)),
    purpose: normalizeText(`${purpose(row)} ${description(row)}`),
    type: optional(normalizeText(kind(row))),
  }));

  return finish({
    format: "c24-csv",
    accountName: filled.length > 0 ? optional(normalizeText(accountName(filled[0]!.row))) : undefined,
    currency: "EUR",
    transactions: indexed(list),
    warnings: [],
  });
}
