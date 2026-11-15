import { mapSevRecurringVoucher, SevdeskApiError, type SevdeskClient, type SevFile } from "@haben/import";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { today } from "../../today.ts";
import { importSevdeskDauerbeleg } from "../belege/index.ts";
import { progressMessage } from "./lexoffice.ts";

/*
 * Vorlagen wiederkehrender Belege aus sevDesk (GET /Voucher?voucherType=RV) als Dauerbelege (#472). Jede kommt angehalten an,
 * eine mit abgelaufenem Ende beendet; der Nutzer prüft sie und setzt fort. Eine schon übernommene Vorlage fragt der Abruf
 * nicht erneut an, so bleiben Änderungen des Nutzers. Was sich nicht abbilden lässt (Einnahme, Intervall, Steuersatz),
 * nennt der Fortschritt mit Grund; diese Vorlagen legt der Nutzer bei Bedarf selbst an.
 */
export async function importSevdeskRecurringVouchers(
  actor: string,
  client: SevdeskClient,
  progress: LexofficeImportProgress,
  signal: AbortSignal,
  known: Set<string>,
  /** Lädt die Datei der Vorlage; der Lauf teilt sie mit den Belegen aus der Vorlage */
  download: (documentId: string) => Promise<SevFile | null> = (id) => client.document(id),
): Promise<void> {
  for await (const raw of client.recurringVouchers()) {
    const id = String(raw.id);
    // Der Filter gilt laut Version 1.0; was dennoch kein RV ist, ist ein gewöhnlicher Beleg aus der Liste davor
    if (known.has(id) || (raw.voucherType ?? "").toUpperCase() !== "RV") continue;
    const number = raw.description?.trim() || `Vorlage ${id}`;
    try {
      const positions = await client.voucherPositions(id);
      const mapped = mapSevRecurringVoucher(raw, positions, today());
      if (!mapped.ok) {
        progress.failed.push({ lexofficeId: `recurring/${id}`, number, message: `Nicht als Dauerbeleg übernommen: ${mapped.grund}` });
        continue;
      }
      const file = mapped.dauerbeleg.documentId ? await download(mapped.dauerbeleg.documentId) : null;
      const contract = file ? { bytes: file.bytes, filename: file.filename ?? `${number}.pdf` } : null;
      if (await importSevdeskDauerbeleg(actor, mapped.dauerbeleg, { voucher: raw, positions }, contract)) {
        progress.recurring = (progress.recurring ?? 0) + 1;
        if (contract) progress.files += 1;
      }
    } catch (error) {
      if (signal.aborted || (error instanceof SevdeskApiError && (error.status === 401 || error.status === 403))) throw error;
      progress.failed.push({ lexofficeId: `recurring/${id}`, number, message: `Vorlage nicht übernommen: ${progressMessage(error)}` });
    }
  }
}
