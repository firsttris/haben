import { finish, indexed, optional, type Tx } from "./common.ts";
import { isBlankRow } from "./csv.ts";
import { Columns } from "./table.ts";
import { normalizeIban, normalizeText, parseDate, parseGermanAmount, requireDate } from "./text.ts";
import type { ParsedStatement } from "./types.ts";

/*
 * Swan exportiert den Kontoauszug als CSV mit einem Kopfblock aus Schlüssel-Wert-Zeilen
 * (Kontentyp, IBAN, Alter Kontostand, Neuer Kontostand, Von, Bis), einer Leerzeile und
 * danach der Tabelle. Datum als TT/MM/JJJJ, Beträge deutsch mit Euro-Zeichen.
 *
 * Eingang und Ausgang stehen in getrennten Spalten; welche gefüllt ist, bestimmt das
 * Vorzeichen. Die Gegen-IBAN steht je nach Richtung in „Von (IBAN)“ oder „An (IBAN)“.
 */
export function isSwanHeader(c: Columns): boolean {
  return c.has("datum") && c.has("name") && c.has("verwendungszweck") && (c.has("krediteur") || c.has("debiteur"));
}

/** Zeilen des Kopfblocks als Schlüssel-Wert-Paare, Schlüssel normalisiert. */
function kopf(rows: string[][], headerRow: number): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows.slice(0, headerRow)) {
    const schluessel = normalizeText(row[0]).toLowerCase();
    if (!schluessel) continue;
    map.set(schluessel, normalizeText(row[1]));
  }
  return map;
}

export function parseSwan(rows: string[][], headerRow: number): ParsedStatement {
  const c = new Columns(rows[headerRow]!);
  const datum = c.getter("datum");
  const name = c.getter("name");
  const typ = c.getter("type");
  const zweck = c.getter("verwendungszweck");
  const kredit = c.getter("krediteur");
  const debit = c.getter("debiteur");
  const von = c.getter("von");
  const an = c.getter("an");

  const meta = kopf(rows, headerRow);
  const warnings: string[] = [];
  const list: Tx[] = [];

  rows.slice(headerRow + 1).forEach((row, i) => {
    if (isBlankRow(row)) return;
    const where = `Zeile ${headerRow + i + 2}`;
    const ein = parseGermanAmount(kredit(row));
    const aus = parseGermanAmount(debit(row));

    if (ein !== null && aus !== null) {
      warnings.push(`${where}: Eingang und Ausgang gefüllt, der Ausgang gilt.`);
    }
    if (ein === null && aus === null) {
      warnings.push(`${where}: weder Eingang noch Ausgang gefüllt, übersprungen.`);
      return;
    }

    list.push({
      bookingDate: requireDate(datum(row), where),
      amount: ein !== null ? ein : -aus!,
      currency: "EUR",
      counterpartyName: normalizeText(name(row)),
      counterpartyIban: normalizeIban(von(row)) ?? normalizeIban(an(row)),
      purpose: normalizeText(zweck(row)),
      type: optional(normalizeText(typ(row))),
    });
  });

  const vonDatum = parseDate(meta.get("von") ?? "");
  const bisDatum = parseDate(meta.get("bis") ?? "");
  const alt = parseGermanAmount(meta.get("alter kontostand") ?? "");
  const neu = parseGermanAmount(meta.get("neuer kontostand") ?? "");

  return finish({
    format: "swan-csv",
    accountIban: normalizeIban(meta.get("iban")),
    currency: (meta.get("kontowährung") || "EUR").toUpperCase(),
    periodFrom: vonDatum ?? undefined,
    periodTo: bisDatum ?? undefined,
    openingBalance: alt ?? undefined,
    closingBalance: neu ?? undefined,
    transactions: indexed(list),
    warnings,
  });
}
