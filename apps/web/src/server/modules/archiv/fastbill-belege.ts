import { type FbFile, type LegacyVoucher, unwrapFormUpload } from "@haben/import";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { unzipSync } from "fflate";
import { decrypt, encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { loadFile, sniff, storeFile } from "../../storage.ts";
import { FastbillError } from "./fastbill-zugang.ts";

/*
 * Ausgabenbelege, die FastBill nur im angemeldeten Browser herausgibt (DOCUMENT_URL liefert der API eine leere Seite).
 * Der Abruf merkt solche Ausgaben in fastbill_receipts vor, das Browser-Skript public/fastbill-belege.js lädt die Dateien,
 * der Upload legt sie bereit, und der nächste Abruf archiviert die Ausgabe mit ihrer Datei.
 */

/**
 * Was mit einer Ausgabe ohne Datei aus der API geschieht: die bereitliegende Datei aus dem Browser-Skript, „ohne_beleg“
 * nach ausdrücklicher Entscheidung, sonst „wartet“ (vorgemerkt, nicht archivieren).
 */
export async function waitingReceipt(
  actor: string,
  expenseId: string,
  voucher: Pick<LegacyVoucher, "number" | "date" | "contactName" | "gross">,
  documentUrl: string,
): Promise<FbFile | "ohne_beleg" | "wartet"> {
  const [receipt] = await db.select().from(schema.fastbillReceipts).where(eq(schema.fastbillReceipts.expenseId, expenseId));
  if (receipt?.status === "datei" && receipt.sha256) {
    const bytes = new Uint8Array(await loadFile(receipt.sha256));
    return { bytes, mimeType: receipt.mimeType ?? "application/octet-stream", filename: receipt.filename };
  }
  if (receipt?.status === "ohne_beleg") return "ohne_beleg";
  const waiting = {
    status: "wartet" as const,
    number: voucher.number,
    date: voucher.date,
    supplier: voucher.contactName,
    gross: voucher.gross,
    ciphertext: encrypt(Buffer.from(documentUrl, "utf8")),
    updatedAt: new Date(),
  };
  await withActor(actor, (tx) =>
    tx
      .insert(schema.fastbillReceipts)
      .values({ expenseId, ...waiting })
      // Nur eine wartende Zeile auffrischen: Ein bereitgelegter Beleg oder „ohne Beleg“ bleibt, auch wenn der Upload
      // zwischen dem Lesen oben und hier kam
      .onConflictDoUpdate({ target: schema.fastbillReceipts.expenseId, set: waiting, setWhere: eq(schema.fastbillReceipts.status, "wartet") }),
  );
  return "wartet";
}

/** Während eines FastBill-Abrufs nichts am Zwischenlager ändern; der Lauf liest und schreibt es gerade */
async function refuseWhileRunning() {
  const [run] = await db
    .select({ id: schema.lexofficeImports.id })
    .from(schema.lexofficeImports)
    .where(and(eq(schema.lexofficeImports.source, "fastbill"), eq(schema.lexofficeImports.status, "laeuft")))
    .limit(1);
  if (run) throw new FastbillError("Während eines Abrufs aus FastBill geht das nicht. Warte, bis er fertig ist, oder brich ihn ab.");
}

/** Format des ZIPs aus dem Browser-Skript public/fastbill-belege.js */
export const FASTBILL_RECEIPTS_FORMAT = "haben-fastbill-belege";
/** Dateiarten, die als Beleg angenommen werden */
const RECEIPT_KINDS = new Set(["pdf", "jpeg", "png", "webp", "heic"]);

function accepted(bytes: Uint8Array): boolean {
  const kind = sniff(bytes);
  return kind !== null && RECEIPT_KINDS.has(kind.kind);
}

/** Ausgaben, die auf ihren Beleg warten oder deren Beleg schon bereitliegt; ohne die Download-Adressen */
export async function fastbillReceiptsOverview() {
  return db
    .select({
      expenseId: schema.fastbillReceipts.expenseId,
      status: schema.fastbillReceipts.status,
      number: schema.fastbillReceipts.number,
      date: schema.fastbillReceipts.date,
      supplier: schema.fastbillReceipts.supplier,
      gross: schema.fastbillReceipts.gross,
      filename: schema.fastbillReceipts.filename,
    })
    .from(schema.fastbillReceipts)
    .orderBy(asc(schema.fastbillReceipts.date), asc(schema.fastbillReceipts.expenseId));
}

/** Je Jahr, wie viele Ausgaben noch nicht im Archiv sind, weil sie auf ihren Beleg warten (auch bereit oder „ohne Beleg“) */
export async function fastbillWaitingByYear(): Promise<Map<number, number>> {
  const rows = await db
    .select({ year: sql<number>`extract(year from ${schema.fastbillReceipts.date})::int`, count: sql<number>`count(*)::int` })
    .from(schema.fastbillReceipts)
    .groupBy(sql`1`);
  return new Map(rows.filter((r) => r.year).map((r) => [r.year, r.count]));
}

/** Liste für das Browser-Skript: ID und Download-Adresse jeder wartenden Ausgabe */
export async function fastbillReceiptScriptList(): Promise<{ id: string; url: string }[]> {
  const rows = await db
    .select({ id: schema.fastbillReceipts.expenseId, ciphertext: schema.fastbillReceipts.ciphertext })
    .from(schema.fastbillReceipts)
    .where(eq(schema.fastbillReceipts.status, "wartet"))
    .orderBy(asc(schema.fastbillReceipts.expenseId));
  return rows.flatMap((r) => (r.ciphertext ? [{ id: r.id, url: decrypt(r.ciphertext).toString("utf8") }] : []));
}

export interface FastbillReceiptUpload {
  /** einer wartenden Ausgabe zugeordnet */
  accepted: number;
  /** ID, die nicht (mehr) wartet, etwa schon archiviert */
  unknown: number;
  /** kein PDF oder Bild */
  invalid: string[];
}

/**
 * Übernimmt ein ZIP aus dem Browser-Skript: manifest.json mit dem Format, je Beleg belege/<INVOICE_ID>.<endung>. Die
 * Zuordnung läuft nur über die ID im Namen, die das Skript selbst vergibt; die Art der Datei prüft Haben am Inhalt.
 * Archiviert wird erst beim nächsten Abruf, zusammen mit der Ausgabe.
 */
export async function uploadFastbillReceipts(actor: string, zip: Uint8Array): Promise<FastbillReceiptUpload> {
  await refuseWhileRunning();
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw new FastbillError("Die Datei ist kein lesbares ZIP.");
  }
  let manifest: { format?: unknown } | null = null;
  try {
    manifest = entries["manifest.json"] ? (JSON.parse(new TextDecoder().decode(entries["manifest.json"])) as { format?: unknown }) : null;
  } catch {
    manifest = null;
  }
  if (manifest?.format !== FASTBILL_RECEIPTS_FORMAT) {
    throw new FastbillError("Das ZIP stammt nicht aus dem Skript für FastBill-Belege (manifest.json fehlt oder passt nicht).");
  }
  const waiting = new Set(
    (
      await db
        .select({ id: schema.fastbillReceipts.expenseId })
        .from(schema.fastbillReceipts)
        .where(inArray(schema.fastbillReceipts.status, ["wartet", "datei"]))
    ).map((r) => r.id),
  );
  const result: FastbillReceiptUpload = { accepted: 0, unknown: 0, invalid: [] };
  for (const [path, bytes] of Object.entries(entries)) {
    const match = /^belege\/(\d+)\.[a-z0-9]{2,5}$/i.exec(path);
    if (!match) continue;
    const id = match[1]!;
    if (!waiting.has(id)) {
      result.unknown += 1;
      continue;
    }
    // Manche Belege liegen bei FastBill samt Hülle des Formular-Uploads; dann zählt die Datei darin, Byte für Byte
    const file = accepted(bytes) ? bytes : unwrapFormUpload(bytes);
    const kind = file ? sniff(file) : null;
    if (!file || !kind || !RECEIPT_KINDS.has(kind.kind)) {
      result.invalid.push(path);
      continue;
    }
    const sha256 = await storeFile(file);
    await withActor(actor, (tx) =>
      tx
        .update(schema.fastbillReceipts)
        .set({ status: "datei", sha256, filename: path.slice("belege/".length), mimeType: kind.mimeType, size: file.byteLength, updatedAt: new Date() })
        .where(eq(schema.fastbillReceipts.expenseId, id)),
    );
    result.accepted += 1;
  }
  return result;
}

/** Wartende Ausgaben ohne Datei archivieren lassen, etwa wenn es in FastBill wirklich keinen Beleg gibt */
export async function markFastbillWithoutReceipt(actor: string, expenseIds?: string[]): Promise<number> {
  await refuseWhileRunning();
  const rows = await withActor(actor, (tx) =>
    tx
      .update(schema.fastbillReceipts)
      .set({ status: "ohne_beleg", updatedAt: new Date() })
      .where(
        expenseIds
          ? and(eq(schema.fastbillReceipts.status, "wartet"), inArray(schema.fastbillReceipts.expenseId, expenseIds))
          : eq(schema.fastbillReceipts.status, "wartet"),
      )
      .returning({ id: schema.fastbillReceipts.expenseId }),
  );
  return rows.length;
}
