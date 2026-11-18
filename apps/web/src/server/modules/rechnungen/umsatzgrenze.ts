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
 * Stelle für den vereinnahmten Umsatz (#1108): Er entsteht in `auswertungen` aus der EÜR des Journals, die selbst
 * `rechnungen` braucht. Damit kein Ring zwischen den Modulen entsteht, belegt `server/plugins/umsatzgrenze.ts` die Stelle
 * beim Start einmal; Tests, die Kleinunternehmer-Rechnungen festschreiben, belegen sie in ihrem Aufbau.
 */
let umsatzStand: UmsatzStand | null = null;

export function belegeUmsatzStand(stand: UmsatzStand): void {
  umsatzStand = stand;
}

/**
 * Rückfrage anhand des vereinnahmten Umsatzes und des Netto-Rechnungsbetrags. Ist die Stelle nicht belegt, bricht das
 * Festschreiben ab, statt die Rückfrage still auszulassen.
 */
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

  if (!umsatzStand) throw new Error("Die Prüfung der Kleinunternehmergrenze ist nicht eingerichtet (server/plugins/umsatzgrenze.ts).");
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
