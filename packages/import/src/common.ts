import type { Cents } from "@haben/core";
import { StatementParseError } from "./errors.ts";
import type { ParsedStatement, ParsedTransaction } from "./types.ts";
import { minMaxDate } from "./text.ts";

export function requireAmount(value: Cents | null, raw: string, where: string): Cents {
  if (value === null) throw new StatementParseError(`Ungültiger Betrag „${raw}“ (${where}).`);
  return value;
}

/**
 * Kontostand aus dem Dateikopf: gilt als Endsaldo, wenn er nicht vor der letzten Buchung liegt
 * und nicht nach dem Ende des Zeitraums; der Anfangssaldo ergibt sich dann aus den Umsätzen.
 */
export function applyStatedBalance(
  statement: ParsedStatement,
  stated: { date: string; amount: Cents } | undefined,
): void {
  if (!stated) return;
  statement.statedBalance = stated;
  const lastBooking = minMaxDate(statement.transactions.map((t) => t.bookingDate)).to;
  const afterPeriod = statement.periodTo !== undefined && stated.date > statement.periodTo;
  if ((lastBooking !== undefined && stated.date < lastBooking) || afterPeriod) {
    statement.warnings.push(
      `Der Kontostand vom ${stated.date} passt nicht zum Zeitraum der Umsätze; Salden werden nicht übernommen.`,
    );
    return;
  }
  const sum = statement.transactions.reduce((acc, t) => acc + t.amount, 0);
  statement.closingBalance = stated.amount;
  statement.openingBalance = stated.amount - sum;
  // Ohne Zeitraum (neues DKB-Format) gilt der Endsaldo am Stichtag, nicht am letzten Buchungstag
  statement.periodTo ??= stated.date;
}

/** Zeitraum aus den Buchungstagen ergänzen, Währung prüfen. */
export function finish(statement: ParsedStatement): ParsedStatement {
  const { from, to } = minMaxDate(statement.transactions.map((t) => t.bookingDate));
  statement.periodFrom ??= from;
  statement.periodTo ??= to;
  const foreign = new Set(
    [statement.currency, ...statement.transactions.map((t) => t.currency)].filter((c) => c !== "EUR"),
  );
  if (foreign.size > 0) {
    statement.warnings.push(`Fremdwährung in der Datei: ${[...foreign].join(", ")}. Haben bucht nur in Euro.`);
  }
  return statement;
}

export function pendingWarning(count: number): string[] {
  if (count === 0) return [];
  return [
    count === 1
      ? "1 vorgemerkter Umsatz wurde übersprungen."
      : `${count} vorgemerkte Umsätze wurden übersprungen.`,
  ];
}

export function optional(value: string): string | undefined {
  return value === "" ? undefined : value;
}

/** Platzhalter der Banken für fehlende Referenzen ignorieren. */
export function optionalReference(value: string | undefined): string | undefined {
  const ref = (value ?? "").trim();
  return ref === "" || /^(NOTPROVIDED|NONREF)$/i.test(ref) ? undefined : ref;
}

export type Tx = Omit<ParsedTransaction, "index">;

export function indexed(list: Tx[]): ParsedTransaction[] {
  return list.map((t, index) => ({ ...t, index }));
}
