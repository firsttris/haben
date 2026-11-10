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
 * Das Sheet führt je Zeile die Kontonummer (Spalte B). Sind in Accountable mehrere Konten verknüpft,
 * kommen ihre Bewegungen gemischt an. Deshalb ein Auszug je Konto: alle in einen zu legen hieße, die
 * Umsätze des zweiten Kontos unter der IBAN des ersten zu buchen, und dann stimmen beide Kontostände
 * nicht mehr.
 *
 * Salden nennt das Sheet nicht. `openingBalance` und `closingBalance` bleiben deshalb leer; die
 * Kontinuitätsprüfung von `storeStatement` greift dann nicht, und der Kontostand kommt aus der Summe
 * der Umsätze. Wer den echten Saldo prüfen will, nimmt den Kontoauszug der Bank daneben.
 */
export function accountableStatements(exp: AccountableExport): ParsedStatement[] {
  const nachKonto = new Map<string, AccountableExport["bankMovements"]>();
  for (const m of exp.bankMovements) {
    if (m.date === null || m.amount === null) continue;
    const konto = m.account || "";
    const liste = nachKonto.get(konto);
    if (liste) liste.push(m);
    else nachKonto.set(konto, [m]);
  }

  const auszuege: ParsedStatement[] = [];
  for (const [konto, movements] of nachKonto) {
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

    auszuege.push({
      format: "accountable-xlsx",
      accountIban: konto || undefined,
      currency: "EUR",
      periodFrom: daten[0],
      periodTo: daten[daten.length - 1],
      transactions,
      warnings: offen > 0 ? [`${offen} Kontobewegungen hat Accountable keinem Beleg zugeordnet.`] : [],
    });
  }
  return auszuege;
}
