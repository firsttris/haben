import { finish, indexed, optional, requireAmount, type Tx } from "./common.ts";
import { isBlankRow } from "./csv.ts";
import { Columns } from "./table.ts";
import { normalizeIban, normalizeText, parseDate, parseDotAmount, requireDate } from "./text.ts";
import type { ParsedStatement } from "./types.ts";

export function isN26Header(c: Columns): boolean {
  return (c.has("bookingdate") || c.has("date")) && c.has("amount") && (c.has("partnername") || c.has("payee"));
}

/** N26-Export, aktuelles und älteres Spaltenschema. Keine eigene IBAN, keine Salden. */
export function parseN26(rows: string[][], headerRow: number): ParsedStatement {
  const c = new Columns(rows[headerRow]!);
  const bookingDate = c.getter("bookingdate", "date");
  const valueDate = c.getter("valuedate");
  const name = c.getter("partnername", "payee");
  const iban = c.getter("partneriban", "accountnumber");
  const type = c.getter("type", "transactiontype");
  const reference = c.getter("paymentreference");
  const accountName = c.getter("accountname");
  const amount = c.getter("amount");

  const list: Tx[] = [];
  let account: string | undefined;
  rows.slice(headerRow + 1).forEach((row, i) => {
    if (isBlankRow(row)) return;
    const where = `Zeile ${headerRow + i + 2}`;
    account ??= optional(normalizeText(accountName(row)));
    const purpose = normalizeText(reference(row));
    list.push({
      bookingDate: requireDate(bookingDate(row), where),
      valueDate: parseDate(valueDate(row)) ?? undefined,
      amount: requireAmount(parseDotAmount(amount(row)), amount(row), where),
      currency: "EUR",
      counterpartyName: normalizeText(name(row)),
      counterpartyIban: normalizeIban(iban(row)),
      // N26 schreibt "-", wenn es keinen Verwendungszweck gibt
      purpose: purpose === "-" ? "" : purpose,
      type: optional(normalizeText(type(row))),
    });
  });

  return finish({
    format: "n26-csv",
    accountName: account,
    currency: "EUR",
    transactions: indexed(list),
    warnings: [],
  });
}
