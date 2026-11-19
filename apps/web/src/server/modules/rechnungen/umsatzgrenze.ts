import type { Cents } from "@haben/core";
import type { UmsatzgrenzeBestaetigung } from "../../../lib/kleinunternehmer.ts";
import type { Tx } from "../../db/index.ts";
import { today } from "../../today.ts";
import type { Invoice } from "./invoices.ts";
import { InvoiceError } from "./invoice-error.ts";

export class UmsatzgrenzeError extends InvoiceError {
  constructor(
    readonly umsatz: Cents,
    readonly rechnung: Cents,
    readonly grenze: Cents,
    readonly vorjahresumsatz?: Cents,
  ) {
    super(
      vorjahresumsatz === undefined
        ? "Bei Zahlung dieser Rechnung könnte die Kleinunternehmergrenze überschritten werden. Prüfe den Umsatz und schreibe die Rechnung von Hand fest."
        : "Der erfasste Vorjahresumsatz liegt über der Kleinunternehmergrenze. Prüfe die Besteuerung und schreibe die Rechnung von Hand fest.",
    );
  }
}

/** Vereinnahmter Umsatz für die Rückfrage, wie ihn `auswertungen` rechnet (`kleinunternehmerStand`) */
export type UmsatzStand = (
  heute: string,
  foundedOn: string | null,
  tx: Tx,
) => Promise<{ aktuell: { netto: number }; vorjahr: { netto: number }; jahresgrenze: number; vorjahresgrenzeUeberschritten: boolean }>;

/**
 * Für Storno und Korrektur: Sie sind keine Rechnung (`kind` „rechnung“), die Rückfrage entfällt dort, der Umsatz wird
 * nie gefragt.
 */
export const OHNE_UMSATZSTAND: UmsatzStand = () => {
  throw new Error("Storno und Korrektur fragen den vereinnahmten Umsatz nicht ab.");
};

/**
 * Rückfrage anhand des vereinnahmten Umsatzes und des Netto-Rechnungsbetrags. Den Umsatz rechnet `auswertungen` aus der
 * EÜR des Journals, die selbst `rechnungen` braucht (#1108); wer festschreibt, übergibt deshalb `umsatzStand`
 * (`kleinunternehmerStand`), statt dass `rechnungen` ihn importiert.
 */
export async function pruefeUmsatzgrenze(
  tx: Tx,
  invoice: Pick<Invoice, "kind" | "issueDate" | "taxTreatment">,
  rechnung: number,
  foundedOn: string | null,
  umsatzStand: UmsatzStand,
  bestaetigt?: UmsatzgrenzeBestaetigung,
): Promise<void> {
  if (invoice.kind !== "rechnung" || invoice.taxTreatment !== "kleinunternehmer" || rechnung <= 0) return;
  const heute = today();
  if (invoice.issueDate > `${heute.slice(0, 4)}-12-31`) return;

  const { aktuell, vorjahr, jahresgrenze, vorjahresgrenzeUeberschritten } = await umsatzStand(heute, foundedOn, tx);
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
