import type { SevdeskClient } from "@haben/import";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { importSevdeskDunnings } from "./sevdesk-mahnungen.ts";
import { importSevdeskTaxSets } from "./sevdesk-steuerarten.ts";
import { importSevdeskVatReports } from "./sevdesk-voranmeldungen.ts";

/** Was aus sevDesk nur ins Archiv kommt, ohne Buchungs- oder Steuerwirkung (#472): Mahnungen, übermittelte Voranmeldungen und Steuerarten */
export async function importSevdeskArchiveOnly(
  actor: string,
  importId: string,
  client: SevdeskClient,
  progress: LexofficeImportProgress,
  signal: AbortSignal,
): Promise<void> {
  await importSevdeskDunnings(actor, importId, client, progress, signal);
  await importSevdeskVatReports(actor, importId, client, progress, signal);
  await importSevdeskTaxSets(actor, importId, client, progress, signal);
}
