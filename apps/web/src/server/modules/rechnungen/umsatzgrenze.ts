import type { UmsatzgrenzeBestaetigung } from "../../../lib/kleinunternehmer.ts";
import type { Tx } from "../../db/index.ts";
import { today } from "../../today.ts";
import { kleinunternehmerStand } from "../auswertungen/index.ts";
import type { Invoice } from "./invoices.ts";
import { InvoiceError } from "./invoice-error.ts";

export class UmsatzgrenzeError extends InvoiceError {
  constructor(
    readonly umsatz: number,
    readonly rechnung: number,
    readonly grenze: number,
    readonly vorjahresumsatz?: number,
  ) {
    super(
      vorjahresumsatz === undefined
        ? "Bei Zahlung dieser Rechnung könnte die Kleinunternehmergrenze überschritten werden. Prüfe den Umsatz und schreibe die Rechnung von Hand fest."
        : "Der erfasste Vorjahresumsatz liegt über der Kleinunternehmergrenze. Prüfe die Besteuerung und schreibe die Rechnung von Hand fest.",
    );
  }
}

/** Rückfrage anhand des vereinnahmten Umsatzes und des Netto-Rechnungsbetrags. */
export async function pruefeUmsatzgrenze(
  tx: Tx,
  invoice: Pick<Invoice, "kind" | "issueDate" | "taxTreatment">,
  rechnung: number,
  foundedOn: string | null,
  bestaetigt?: UmsatzgrenzeBestaetigung,
): Promise<void> {
  if (invoice.kind !== "rechnung" || invoice.taxTreatment !== "kleinunternehmer" || rechnung <= 0) return;
  const heute = today();
  if (invoice.issueDate > `${heute.slice(0, 4)}-12-31`) return;

  const { aktuell, vorjahr, jahresgrenze, vorjahresgrenzeUeberschritten } = await kleinunternehmerStand(heute, foundedOn, tx);
  if (!vorjahresgrenzeUeberschritten && aktuell.netto + rechnung <= jahresgrenze) return;
  const vorjahresumsatz = vorjahresgrenzeUeberschritten ? vorjahr.netto : undefined;
  if (
    bestaetigt?.umsatz === aktuell.netto &&
    bestaetigt.rechnung === rechnung &&
    bestaetigt.grenze === jahresgrenze &&
    bestaetigt.vorjahresumsatz === vorjahresumsatz
  )
    return;
  throw new UmsatzgrenzeError(aktuell.netto, rechnung, jahresgrenze, vorjahresumsatz);
}
