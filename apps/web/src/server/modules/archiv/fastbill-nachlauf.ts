import type { FastbillClient } from "@haben/import";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { importFastbillEstimates } from "./fastbill-angebote.ts";
import { FastbillError } from "./fastbill-zugang.ts";
import { importFastbillRecurring } from "./fastbill-vorlagen.ts";

/*
 * Schritte des FastBill-Abrufs nach den Belegen: Vorlagen wiederkehrender Rechnungen (#1520) und Angebote (#1521). Beide
 * finden ihren Kunden über contacts.fastbill_id und laufen deshalb erst nach den Kunden. Fehler je Vorlage oder Angebot
 * landen in progress.failed; Abbruch und abgelehnte Zugangsdaten beenden den Lauf.
 */
export async function importAfterVouchers(
  actor: string,
  importId: string,
  client: FastbillClient,
  progress: LexofficeImportProgress,
  signal: AbortSignal,
  save: (force?: boolean) => Promise<void>,
): Promise<void> {
  for (const step of [importFastbillRecurring, importFastbillEstimates]) {
    if (signal.aborted) throw new FastbillError("Abgebrochen.");
    await step(actor, importId, client, progress, signal);
    await save(true);
  }
}
