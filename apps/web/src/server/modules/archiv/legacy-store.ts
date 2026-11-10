import { asc, sql } from "drizzle-orm";
import { db, schema, type Tx } from "../../db/index.ts";
import { sha256Of, storeFile } from "../../storage.ts";

/** Lokale Pakete zählen als vorhandener Umzugsbestand, auch ohne Anbieterzugang. */
export async function externalImportOverview() {
  return db
    .select({ source: schema.externalImports.source, count: sql<number>`count(*)::int` })
    .from(schema.externalImports)
    .groupBy(schema.externalImports.source)
    .orderBy(asc(schema.externalImports.source));
}

export interface LegacyOriginalFile {
  role: "pdf" | "xml" | "anhang";
  sourceFileId: string | null;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface LegacyKnownPayment {
  externalId: string;
  date: string;
  amount: number;
  accountName: string | null;
  evidence: Record<string, unknown>;
}

/** Gemeinsamer Schreiber für API-Umzüge und geprüfte Pakete; keine neue Ausstellung oder Buchung. */
export async function storeLegacyVoucher(
  tx: Tx,
  voucher: typeof schema.lexofficeVouchers.$inferInsert,
  files: LegacyOriginalFile[],
  payments: LegacyKnownPayment[] = [],
): Promise<{ id: string; files: number } | null> {
  const [row] = await tx
    .insert(schema.lexofficeVouchers)
    .values(voucher)
    .onConflictDoNothing({ target: schema.lexofficeVouchers.lexofficeId })
    .returning({ id: schema.lexofficeVouchers.id });
  if (!row) return null;
  const seen = new Set<string>();
  for (const file of files) {
    const sha256 = sha256Of(file.bytes);
    if (seen.has(sha256)) continue;
    seen.add(sha256);
    await storeFile(file.bytes);
    await tx.insert(schema.lexofficeVoucherFiles).values({
      voucherId: row.id,
      role: file.role,
      lexofficeFileId: file.sourceFileId,
      filename: file.filename.slice(0, 200),
      mimeType: file.mimeType.split(";")[0]!.trim() || "application/octet-stream",
      sha256,
      size: file.bytes.byteLength,
    });
  }
  for (const payment of payments)
    await tx.insert(schema.legacyVoucherPayments).values({
      voucherId: row.id,
      importId: voucher.importId,
      source: voucher.source ?? "lexoffice",
      externalId: payment.externalId,
      date: payment.date,
      amount: payment.amount,
      accountName: payment.accountName,
      raw: payment.evidence,
    });
  return { id: row.id, files: seen.size };
}

/** Derselbe Auftragsdokumentbestand für Anbieterabruf und lokale Originalpakete. */
export async function storeLegacyOrder(
  tx: Tx,
  document: typeof schema.legacyOrderDocuments.$inferInsert,
  files: LegacyOriginalFile[],
): Promise<{ id: string; files: number } | null> {
  const [row] = await tx
    .insert(schema.legacyOrderDocuments)
    .values(document)
    .onConflictDoNothing({ target: schema.legacyOrderDocuments.externalId })
    .returning({ id: schema.legacyOrderDocuments.id });
  if (!row) return null;
  const seen = new Set<string>();
  for (const file of files) {
    const sha256 = sha256Of(file.bytes);
    if (seen.has(sha256)) continue;
    seen.add(sha256);
    await storeFile(file.bytes);
    await tx.insert(schema.legacyOrderFiles).values({
      orderId: row.id,
      origin: document.source === "import" ? "import" : "sevdesk",
      filename: file.filename.slice(0, 200),
      mimeType: file.mimeType,
      sha256,
      size: file.bytes.byteLength,
    });
  }
  return { id: row.id, files: seen.size };
}
