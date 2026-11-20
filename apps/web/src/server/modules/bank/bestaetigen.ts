import { withActor } from "../../db/actor.ts";
import { BESTAETIGEN_HOECHSTENS } from "../../../lib/bestaetigen-grenze.ts";
import { listAccounts, ownAccounts } from "./accounts.ts";
import { allocateIn, allocateSplitIn } from "./allocation.ts";
import { openItems } from "./offene-posten.ts";
import { listTransactions } from "./transaction-list.ts";
import { BankError } from "./bank-error.ts";
import { mitHinweisen } from "./umsatzauswahl.ts";

const germanDate = (day: string) => day.split("-").reverse().join(".");

/**
 * Bestätigt die Vorschläge der Liste (#1440): bucht je Umsatz genau das, was die Liste als Vorschlag zeigt, über
 * allocateIn, also dieselbe Buchung wie „Zuordnen“ bzw. „Buchen“. Der Vorschlag wird hier neu berechnet und nicht vom
 * Browser übernommen. Alles geschieht in einer Transaktion: Scheitert ein Umsatz, wird nichts gebucht, und die Meldung
 * nennt ihn.
 */
export async function bestaetigeVorschlaege(actor: string, transactionIds: readonly string[]): Promise<void> {
  const ids = [...new Set(transactionIds)];
  if (ids.length === 0) throw new BankError("Kein Umsatz gewählt.");
  if (ids.length > BESTAETIGEN_HOECHSTENS) throw new BankError(`Höchstens ${BESTAETIGEN_HOECHSTENS} Umsätze auf einmal.`);
  const konten = await listAccounts();
  const rows = await listTransactions(
    konten.map((k) => k.id),
    "alle",
    "",
    undefined,
    undefined,
    ids,
  );
  const [items, own] = await Promise.all([openItems(), ownAccounts()]);
  const mitVorschlag = await mitHinweisen(rows, items, own, konten);
  const byId = new Map(mitVorschlag.map((row) => [row.id, row]));
  const name = (row: { counterpartyName: string; bookingDate: string; amount: number }) =>
    `${row.counterpartyName || "ohne Gegenpartei"} vom ${germanDate(row.bookingDate)}`;
  // Erst alles prüfen, dann buchen: Ein Umsatz ohne Vorschlag soll nichts anderes mitreißen
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw new BankError("Ein gewählter Umsatz ist nicht mehr vorhanden.");
    if (!row.bestaetigung) throw new BankError(`Für den Umsatz ${name(row)} gibt es keinen Vorschlag zum Bestätigen. Es wurde nichts gebucht.`);
  }
  await withActor(actor, async (tx) => {
    for (const id of ids) {
      const row = byId.get(id)!;
      try {
        const bestaetigung = row.bestaetigung!;
        await ("split" in bestaetigung ? allocateSplitIn(tx, bestaetigung.split) : allocateIn(tx, bestaetigung.input));
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unbekannter Fehler";
        throw new BankError(`Umsatz ${name(row)}: ${reason} Es wurde nichts gebucht.`);
      }
    }
  });
}
