import type { AccountableExport } from "./source.ts";
import type { ParsedStatement, ParsedTransaction } from "../types.ts";

/*
 * Die Kontobewegungen des Exports als Kontoauszug.
 *
 * Accountable führt das verknüpfte Bankkonto im Sheet „Kontobewegungen“ mit. Damit braucht der Umzug
 * keinen eigenen Bankimport: Wer aus Accountable kommt, hat die Umsätze schon im Export, und zwar
 * dieselben, die Accountable beim Zuordnen gesehen hat. Ein Swan-CSV-Import wäre ein zweiter Weg zum
 * selben Ziel und müsste die Umsätze über Betrag und Datum wiederfinden.
 *
 * Salden nennt das Sheet nicht. `openingBalance` und `closingBalance` bleiben deshalb leer; die
 * Kontinuitätsprüfung von `storeStatement` greift dann nicht, und der Kontostand kommt aus der Summe
 * der Umsätze. Wer den echten Saldo prüfen will, nimmt den Kontoauszug der Bank daneben.
 */
export function accountableStatement(exp: AccountableExport): ParsedStatement | null {
  const movements = exp.bankMovements.filter((m) => m.date !== null && m.amount !== null);
  if (movements.length === 0) return null;

  const transactions: ParsedTransaction[] = movements.map((m, index) => ({
    bookingDate: m.date!,
    amount: m.amount!,
    currency: "EUR",
    counterpartyName: m.counterparty,
    counterpartyIban: m.counterpartyAccount || undefined,
    purpose: m.purpose,
    // Der Verwendungszweck trägt die Buchungsart bei Accountable nicht; sie steht nur in der CSV der Bank
    index,
  }));

  const daten = movements.map((m) => m.date!).sort();
  const offen = movements.filter((m) => m.matched === false).length;

  return {
    format: "accountable-xlsx",
    accountIban: movements[0]?.account || undefined,
    currency: "EUR",
    periodFrom: daten[0],
    periodTo: daten[daten.length - 1],
    transactions,
    warnings: offen > 0 ? [`${offen} Kontobewegungen hat Accountable keinem Beleg zugeordnet.`] : [],
  };
}
