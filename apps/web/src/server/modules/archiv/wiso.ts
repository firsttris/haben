import { previewWisoExport, WisoParseError, type WisoPreview } from "@haben/import";
import { and, desc, eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { LegacyPayment, LexofficeImportProgress } from "../../db/schema.ts";
import { UserError } from "../../errors.ts";
import { sha256Of } from "../../storage.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { addArchiveFile, MAX_ARCHIVE_SIZE } from "./archive.ts";
import { finish, progressMessage, STALE_MS } from "./lexoffice.ts";

export const MAX_WISO_CSV_SIZE = MAX_ARCHIVE_SIZE;
export const WISO_ORIGINAL_NOTE = "WISO-Originalexport (Buchungen CSV)";
const SOURCE = "wiso" as const;

export class WisoImportError extends UserError {}

export async function previewWisoCsv(bytes: Uint8Array) {
  const company = await loadCompany();
  try {
    return previewWisoExport(bytes, company.kontenrahmen);
  } catch (error) {
    if (error instanceof WisoParseError) throw new WisoImportError(error.message);
    throw error;
  }
}

export function wisoSummary(preview: WisoPreview) {
  return {
    years: preview.years,
    dateFrom: preview.dateFrom,
    dateTo: preview.dateTo,
    bookings: preview.bookings,
    rows: preview.rows,
    warnings: preview.warnings,
  };
}

export async function latestWisoImport() {
  const [row] = await db
    .select()
    .from(schema.lexofficeImports)
    .where(eq(schema.lexofficeImports.source, SOURCE))
    .orderBy(desc(schema.lexofficeImports.startedAt))
    .limit(1);
  if (!row) return null;
  if (row.status === "laeuft" && Date.now() - row.updatedAt.getTime() > STALE_MS) {
    const [updated] = await db
      .update(schema.lexofficeImports)
      .set({ status: "abgebrochen", error: "Der Import wurde unterbrochen. Ein neuer Import setzt dort fort.", finishedAt: new Date() })
      .where(and(eq(schema.lexofficeImports.id, row.id), eq(schema.lexofficeImports.status, "laeuft")))
      .returning();
    return updated ?? row;
  }
  return row;
}

/**
 * WISO EÜR bucht nach Zahlung: „Zahlungsdatum“ ist der Tag des Zu- oder Abflusses. Als Zahlung festgehalten, zählt die
 * Einnahme bei Ist-Versteuerung im Abgleich in diesem Monat (legacyPayments); offen ist danach nichts. Neutrale Buchungen
 * (Saldovortrag, Geldtransit, Privat) sind kein Entgelt und bekommen keine.
 */
function wisoPayment(item: WisoPreview["vouchers"][number]): LegacyPayment | null {
  if (item.neutral) return null;
  const { date, gross } = item.voucher;
  return { status: "paid", openAmount: 0, paidDate: date, items: [{ type: "payment", date, amount: gross }] };
}

async function archiveOriginalCsv(actor: string, bytes: Uint8Array, filename: string, year: number): Promise<void> {
  const sha256 = sha256Of(bytes);
  const [existing] = await db.select({ id: schema.archiveFiles.id }).from(schema.archiveFiles).where(eq(schema.archiveFiles.sha256, sha256));
  if (existing) return;
  await addArchiveFile(actor, { bytes, filename, kind: "sonstiges", year, note: WISO_ORIGINAL_NOTE }, MAX_WISO_CSV_SIZE);
}

export async function startWisoImport(actor: string, bytes: Uint8Array, filename: string) {
  if ((await latestWisoImport())?.status === "laeuft") {
    throw new WisoImportError("Ein WISO-Import läuft bereits.");
  }
  const preview = await previewWisoCsv(bytes);
  const progress: LexofficeImportProgress = {
    phase: "belege",
    contacts: 0,
    contactsLinked: 0,
    listed: preview.vouchers.length,
    imported: 0,
    skipped: 0,
    files: 0,
    failed: [],
  };
  const [run] = await withActor(actor, (tx) =>
    tx.insert(schema.lexofficeImports).values({ source: SOURCE, progress }).returning({ id: schema.lexofficeImports.id }),
  );
  const importId = run!.id;
  try {
    await archiveOriginalCsv(actor, bytes, filename, preview.years[0]!);
    for (const item of preview.vouchers) {
      const inserted = await withActor(actor, async (tx) => {
        const [existing] = await tx
          .select({ id: schema.lexofficeVouchers.id })
          .from(schema.lexofficeVouchers)
          .where(eq(schema.lexofficeVouchers.lexofficeId, item.voucher.lexofficeId));
        if (existing) return false;
        const v = item.voucher;
        await tx.insert(schema.lexofficeVouchers).values({
          lexofficeId: v.lexofficeId,
          source: SOURCE,
          importId,
          type: v.type,
          direction: v.direction,
          number: v.number,
          date: v.date,
          dueDate: v.dueDate,
          serviceFrom: v.serviceFrom,
          serviceTo: v.serviceTo,
          status: v.status,
          contactId: null,
          contactName: v.contactName,
          currency: v.currency,
          net: v.net,
          tax: v.tax,
          gross: v.gross,
          taxes: v.taxes,
          categories: v.categories.map((c) => ({ ...c, name: "" })),
          payment: wisoPayment(item),
          remark: v.remark,
          raw: item.raw,
        });
        return true;
      });
      if (inserted) progress.imported += 1;
      else progress.skipped += 1;
      if ((progress.imported + progress.skipped) % 20 === 0) {
        await db.update(schema.lexofficeImports).set({ progress, updatedAt: new Date() }).where(eq(schema.lexofficeImports.id, importId));
      }
    }
    await finish(importId, progress, "fertig", null);
    return { id: importId, ...wisoSummary(preview), imported: progress.imported, skipped: progress.skipped };
  } catch (error) {
    const message = progressMessage(error);
    await finish(importId, progress, "fehler", message);
    throw error;
  }
}
