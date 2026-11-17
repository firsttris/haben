import { type Cents, isValidIban } from "@haben/core";
import { finish, indexed, optional, optionalReference, type Tx } from "../common.ts";
import { mappingProblem } from "../csv-import/mapping.ts";
import type { CsvRow } from "../csv-import/read.ts";
import { normalizeIban, normalizeText, parseDate, parseDotAmount, parseGermanAmount } from "../text.ts";
import type { ParsedStatement } from "../types.ts";
import { BANK_CSV_FIELDS, type BankCsvField, type BankCsvMapping } from "./felder.ts";
import { headerOf, sameHeader } from "./lesen.ts";

export interface MappedRow {
  /** Zeile in der Datei, die erste ist 1 */
  line: number;
  errors: string[];
  transaction: Tx | null;
}

export interface MappedStatement {
  /** Fehler in der Zuordnung selbst; dann gibt es keine Umsätze */
  problem: string | null;
  rows: MappedRow[];
  statement: ParsedStatement | null;
}

/** Was in der Zuordnung fehlt oder sich widerspricht */
export function bankMappingProblem(mapping: BankCsvMapping): string | null {
  const { columns, header } = mapping;
  const set = (key: BankCsvField) => columns[key] !== null && columns[key] !== undefined;
  if (!set("bookingDate")) return "Ordne den Buchungstag einer Spalte zu.";
  if (set("amount") && (set("debit") || set("credit"))) return "Ordne entweder den Betrag oder Soll und Haben zu, nicht beides.";
  if (!set("amount") && !(set("debit") && set("credit"))) return "Ordne den Betrag zu oder Soll und Haben.";
  return mappingProblem(columns, header, BANK_CSV_FIELDS);
}

function readMappedRow(row: CsvRow, mapping: BankCsvMapping): MappedRow {
  const errors: string[] = [];
  const width = mapping.header.length;
  if (row.cells.slice(width).some((cell) => cell.trim() !== "")) {
    errors.push(`Die Zeile hat mehr Werte als die Kopfzeile Spalten; steht ein Trennzeichen ohne Anführungszeichen in einem Feld?`);
  }
  const raw = (key: BankCsvField) => {
    const index = mapping.columns[key];
    return index === null || index === undefined ? "" : (row.cells[index] ?? "").trim();
  };
  const amountOf = (key: BankCsvField, label: string): Cents | null => {
    const value = raw(key);
    if (value === "") return null;
    const cents = mapping.amountFormat === "en" ? parseDotAmount(value) : parseGermanAmount(value);
    if (cents === null) errors.push(`${label} „${value}“ ist kein Betrag${mapping.amountFormat === "en" ? " mit Dezimalpunkt" : ""}.`);
    return cents;
  };

  const bookingDate = parseDate(raw("bookingDate"));
  if (!bookingDate) errors.push(raw("bookingDate") === "" ? "Der Buchungstag fehlt." : `Buchungstag „${raw("bookingDate")}“ ist kein Datum.`);
  const valueDate = raw("valueDate") === "" ? null : parseDate(raw("valueDate"));
  if (raw("valueDate") !== "" && !valueDate) errors.push(`Wertstellung „${raw("valueDate")}“ ist kein Datum.`);

  let amount: Cents | null;
  if (mapping.columns.amount !== null && mapping.columns.amount !== undefined) {
    amount = amountOf("amount", "Betrag");
    if (raw("amount") === "") errors.push("Der Betrag fehlt.");
  } else {
    // Soll ist ein Ausgang, Haben ein Eingang, egal ob die Bank ein Minus davorschreibt
    const debit = amountOf("debit", "Soll");
    const credit = amountOf("credit", "Haben");
    const hasDebit = debit !== null && debit !== 0;
    const hasCredit = credit !== null && credit !== 0;
    if (hasDebit && hasCredit) errors.push("Soll und Haben sind beide gefüllt.");
    if (raw("debit") === "" && raw("credit") === "") errors.push("Soll und Haben sind beide leer.");
    amount = hasCredit ? Math.abs(credit) : hasDebit ? -Math.abs(debit) : 0;
  }

  if (amount === 0 && errors.length === 0) errors.push("Der Betrag ist 0,00 €.");
  // Bankkonten führt Haben nur in Euro; ein Betrag in US-Dollar darf nicht als Euro-Betrag auf das Konto
  const currency = raw("currency").toUpperCase() || "EUR";
  if (currency !== "EUR") errors.push(`Währung ${currency}: Haben bucht Bankkonten nur in Euro.`);
  if (errors.length > 0 || !bookingDate || amount === null) return { line: row.line, errors, transaction: null };
  const iban = normalizeIban(raw("counterpartyIban"));
  return {
    line: row.line,
    errors,
    transaction: {
      bookingDate,
      valueDate: valueDate ?? undefined,
      amount,
      currency,
      counterpartyName: normalizeText(raw("counterpartyName")),
      // Manche Banken schreiben die Kontonummer in die Spalte; nur eine gültige IBAN zählt
      counterpartyIban: iban && isValidIban(iban) ? iban : undefined,
      purpose: normalizeText(raw("purpose")),
      type: optional(normalizeText(raw("type"))),
      bankReference: optionalReference(raw("bankReference")),
    },
  };
}

/**
 * Liest die Umsätze einer Bank-CSV nach einer Zuordnung von Hand (#1275). Zeilen mit Fehlern, etwa der Kontostand am
 * Ende der Datei, übernimmt Haben nicht; sie stehen in der Vorschau und als Hinweis am Import.
 */
export function parseMappedStatement(records: CsvRow[], headerRow: number, mapping: BankCsvMapping): MappedStatement {
  const header = headerOf(records[headerRow]?.cells ?? []);
  if (!sameHeader(header, mapping.header)) {
    return { problem: "Die Zuordnung gilt für eine andere Kopfzeile.", rows: [], statement: null };
  }
  const problem = bankMappingProblem(mapping);
  if (problem) return { problem, rows: [], statement: null };
  const rows = records.slice(headerRow + 1).map((row) => readMappedRow(row, mapping));
  const transactions = rows.flatMap((r) => (r.transaction ? [r.transaction] : []));
  if (transactions.length === 0) return { problem: "Keine Zeile ergibt einen Umsatz. Prüfe Kopfzeile und Zuordnung.", rows, statement: null };
  const skipped = rows.filter((r) => !r.transaction);
  const statement = finish({
    format: "csv-zuordnung",
    currency: "EUR",
    transactions: indexed(transactions),
    warnings: skipped.map((r) => `Zeile ${r.line} nicht übernommen: ${r.errors.join(" ")}`),
  });
  return { problem: null, rows, statement };
}
