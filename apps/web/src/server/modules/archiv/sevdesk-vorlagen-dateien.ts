import { SevdeskApiError, type SevdeskClient } from "@haben/import";
import { sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { sha256Of, sniff, storeFile } from "../../storage.ts";
import { progressMessage } from "./lexoffice.ts";

/*
 * Dateien wiederkehrender Belege (#472): sevDesk legt aus einer Vorlage (voucherType RV) jeden Monat einen Beleg an und
 * verweist mit `origin` auf die Vorlage. Die Datei hängt in der API nur an der Vorlage, `document` der erzeugten Belege ist
 * leer; der DATEV-Export führt dieselbe Datei als Belegbild jedes Belegs (in Version 1.0 belegt). Für jeden archivierten
 * Beleg ohne eigene Datei, auch aus früheren Läufen, holt der Abruf deshalb die Vorlage (GET /Voucher/{id}) und hängt deren
 * Datei mit der Rolle „vorlage“ an. Die Archivkopie bleibt unverändert; ein Beleg mit Datei wird nicht mehr angefragt, und
 * dieselbe Datei kommt je Beleg nur einmal an (eindeutig über Beleg und Hash).
 */
export async function importSevdeskTemplateFiles(actor: string, client: SevdeskClient, progress: LexofficeImportProgress, signal: AbortSignal): Promise<void> {
  const rows = await db.execute<{ id: string; templateId: string }>(sql`
    select v.id, v.raw->'origin'->>'id' as "templateId" from lexoffice_vouchers v
    where v.source = 'sevdesk' and v.lexoffice_id like 'voucher/%'
      and coalesce(v.raw->'document'->>'id', '') = ''
      and v.raw->'origin'->>'objectName' = 'Voucher' and coalesce(v.raw->'origin'->>'id', '') <> ''
      and not exists (select 1 from lexoffice_voucher_files f where f.voucher_id = v.id)
    order by 2, 1`);
  const byTemplate = new Map<string, string[]>();
  for (const row of rows) byTemplate.set(row.templateId, [...(byTemplate.get(row.templateId) ?? []), row.id]);

  for (const [templateId, voucherIds] of byTemplate) {
    try {
      const template = await client.voucher(templateId);
      // Nur Vorlagen wiederkehrender Belege; ohne Datei an der Vorlage bleibt der Beleg ohne Datei
      if ((template.voucherType ?? "").toUpperCase() !== "RV") continue;
      const documentId = template.document?.id == null ? "" : String(template.document.id);
      if (!documentId) continue;
      const file = await client.document(documentId);
      if (!file) continue;
      const sha256 = sha256Of(file.bytes);
      await storeFile(file.bytes);
      const kind = sniff(file.bytes)?.kind;
      const filename = (file.filename ?? `Vorlage_${templateId}.${kind === "jpeg" ? "jpg" : (kind ?? "pdf")}`).slice(0, 200);
      const added = await withActor(actor, (tx) =>
        tx
          .insert(schema.lexofficeVoucherFiles)
          .values(
            voucherIds.map((voucherId) => ({
              voucherId,
              role: "vorlage" as const,
              lexofficeFileId: documentId,
              filename,
              mimeType: file.mimeType.split(";")[0]!.trim() || "application/octet-stream",
              sha256,
              size: file.bytes.byteLength,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: schema.lexofficeVoucherFiles.id }),
      );
      progress.files += added.length;
    } catch (error) {
      if (signal.aborted || (error instanceof SevdeskApiError && (error.status === 401 || error.status === 403))) throw error;
      progress.failed.push({
        lexofficeId: `voucher/${templateId}`,
        number: `Vorlage ${templateId}`,
        message: `Datei der Vorlage nicht abgerufen (${voucherIds.length} Belege ohne Datei): ${progressMessage(error)}`,
      });
    }
  }
}
