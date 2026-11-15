import { archiveVoucherOf, type SevExportStack, type SevExportVoucher } from "@haben/import";
import { and, eq, sql } from "drizzle-orm";
import { db, schema, type Tx } from "../../db/index.ts";
import type { LexofficeImportProgress, SevdeskExportProgress } from "../../db/schema.ts";
import { sha256Of, sniff, storeFile } from "../../storage.ts";
import { storeDatevBookings } from "./accountable-import.ts";
import { progressMessage } from "./lexoffice.ts";
import type { StagedSevdeskExport } from "./sevdesk-export.ts";

/*
 * Der Lauf mit der Export-ZIP von sevDesk, in einer Transaktion. Alles nur anhängend:
 *
 * 1. Die ZIP als Original unter „Sonstiges“, jeder Buchungsstapel daraus als DATEV-Buchungsstapel mit seinen Zeilen in
 *    datev_bookings. Liegt die ZIP oder ein Stapel schon im Archiv (gleiche Prüfsumme, etwa auf dem früheren Weg über
 *    „Sonstiges“ und „DATEV-Buchungsstapel“), bleibt es dabei. Belegt ein anderer Stapel den Zeitraum schon, legt der
 *    Lauf den Stapel nicht an, sonst stünden die Buchungen doppelt im Abgleich.
 * 2. Je Beleg ein Archivbeleg (lexoffice_vouchers, Quelle sevdesk-export), Schlüssel die GUID, ohne Beleglink Belegnummer,
 *    Datum, Personenkonto und Kontoart; dazu die Datei in lexoffice_voucher_files. Ein zweiter Lauf überspringt
 *    Bekanntes und hängt höchstens eine fehlende Datei an.
 * 3. Jahre, die schon Belege aus der API haben, bekommen keine Belege aus dem Export: Die API kennt Positionen und
 *    Zahlungen, der Export nicht, und beide zusammen zählten jeden Beleg doppelt.
 *
 * Offene Posten legt der Lauf nicht an: Der Export kennt keinen Zahlungsstand je Beleg (legacy-open.ts lässt die Quelle aus).
 */

export async function runSevdeskExportImport(
  tx: Tx,
  importId: string,
  upload: StagedSevdeskExport,
  progress: LexofficeImportProgress,
  cancelled: () => boolean,
) {
  let lastSave = 0;
  const save = async (force = false) => {
    if (!force && Date.now() - lastSave < 1000) return;
    lastSave = Date.now();
    await tx.update(schema.lexofficeImports).set({ progress, updatedAt: new Date() }).where(eq(schema.lexofficeImports.id, importId));
  };
  const result = progress.sevdeskExport!;
  const year = result.years[0] ?? (Number(upload.export.stacks[0]?.stack.header.dateFrom?.slice(0, 4)) || null);

  // 1. Originale
  result.archivedFileId = await storeZip(tx, importId, upload, year);
  result.stackFileIds = [];
  for (const stack of upload.export.stacks) {
    const id = await storeStack(tx, importId, stack);
    if (id) result.stackFileIds.push(id);
  }
  await save(true);

  // 2. Belege
  const apiYears = new Set(result.apiYears);
  const exp = upload.export;
  for (const voucher of exp.vouchers) {
    if (cancelled()) throw new Error("Abgebrochen.");
    const archive = archiveVoucherOf(exp, voucher);
    if (apiYears.has(Number(voucher.date.slice(0, 4)))) {
      progress.skipped += 1;
      continue;
    }
    try {
      const file = voucher.guid ? (exp.files.get(voucher.guid) ?? null) : null;
      const outcome = await storeVoucher(tx, importId, voucher, archive, file, result.archivedFileId);
      if (outcome.created) progress.imported += 1;
      else progress.skipped += 1;
      if (outcome.fileAdded) progress.files += 1;
    } catch (error) {
      progress.failed.push({ lexofficeId: archive.externalId, number: voucher.number, message: progressMessage(error) });
    }
    await save();
  }
  result.note = noteFor(result);
  await save(true);
}

/** Sätze für die Oberfläche: was schon da war und was nicht angelegt wurde */
function noteFor(r: SevdeskExportProgress): string {
  const stacks = r.stacks.filter((s) => s.state === "zeitraum");
  return [
    r.zipArchived ? "Die ZIP-Datei lag schon im Archiv." : "",
    r.stacks.some((s) => s.state === "vorhanden") ? "Der Buchungsstapel lag schon im Archiv; seine Buchungen sind nicht doppelt angelegt." : "",
    ...stacks.map((s) => `${s.name} nicht angelegt: Der Zeitraum ${s.from} bis ${s.to} liegt schon mit ${s.other} im Archiv.`),
    r.inApiYears > 0 ? `${r.inApiYears} Beleg(e) in ${r.apiYears.join(", ")} nicht angelegt: Für diese Jahre gibt es Belege aus der API.` : "",
    r.withoutImage > 0 ? `${r.withoutImage} Beleg(e) ohne Belegbild im Export.` : "",
    r.missingFile > 0 ? `${r.missingFile} Beleg(e) verweisen auf eine Datei, die im Export fehlt.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

async function existingFile(sha256: string): Promise<string | null> {
  const [row] = await db.select({ id: schema.archiveFiles.id }).from(schema.archiveFiles).where(eq(schema.archiveFiles.sha256, sha256));
  return row?.id ?? null;
}

/** Die ZIP unverändert unter „Sonstiges“; liegt sie schon im Archiv, verweist der Lauf auf sie. */
async function storeZip(tx: Tx, importId: string, upload: StagedSevdeskExport, year: number | null): Promise<string> {
  const sha256 = sha256Of(upload.bytes);
  const known = await existingFile(sha256);
  if (known) return known;
  await storeFile(upload.bytes);
  const [row] = await tx
    .insert(schema.archiveFiles)
    .values({
      kind: "sonstiges",
      year,
      filename: upload.filename.slice(0, 200),
      sha256,
      mimeType: "application/zip",
      size: upload.bytes.byteLength,
      note: `sevDesk-Export „Buchungsdaten & Belegbilder“, Lauf ${importId.slice(0, 8)}`,
    })
    .returning({ id: schema.archiveFiles.id });
  return row!.id;
}

/**
 * Ein Stapel als DATEV-Buchungsstapel mit seinen Zeilen. Gleiche Datei: die vorhandene. Anderer Stapel im selben Zeitraum:
 * null, nichts angelegt (wie addArchiveFile, nur ohne Abbruch des Laufs).
 */
async function storeStack(tx: Tx, importId: string, { name, bytes, stack }: SevExportStack): Promise<string | null> {
  const sha256 = sha256Of(bytes);
  const known = await existingFile(sha256);
  if (known) return known;
  const dates = stack.bookings.map((b) => b.date).sort();
  const from = dates[0];
  const to = dates.at(-1);
  if (!from || !to) return null;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('haben.archive.datev'))`);
  const [overlap] = await tx
    .select({ id: schema.archiveFiles.id })
    .from(schema.archiveFiles)
    .where(
      and(
        eq(schema.archiveFiles.kind, "datev"),
        sql`${schema.archiveFiles.meta} ->> 'dateFrom' <= ${to}`,
        sql`${schema.archiveFiles.meta} ->> 'dateTo' >= ${from}`,
      ),
    )
    .limit(1);
  if (overlap) return null;
  await storeFile(bytes);
  const [row] = await tx
    .insert(schema.archiveFiles)
    .values({
      kind: "datev",
      year: Number((stack.header.fiscalYearStart || from).slice(0, 4)),
      filename: (name.split("/").pop() ?? name).slice(0, 200),
      sha256,
      mimeType: "text/csv",
      size: bytes.byteLength,
      note: `Aus dem sevDesk-Export, Lauf ${importId.slice(0, 8)}`,
      meta: { header: stack.header, dateFrom: from, dateTo: to, bookings: stack.bookings.length, warnings: stack.warnings },
    })
    .returning({ id: schema.archiveFiles.id });
  await storeDatevBookings(tx, row!.id, stack.bookings);
  return row!.id;
}

type Archive = ReturnType<typeof archiveVoucherOf>;

/** Was zum Nachweis am Beleg steht: Zeilen des Stapels, Beleginfo, Ordner und Datei im Export */
function rawOf(voucher: SevExportVoucher, archive: Archive, file: { fileName: string } | null, zipFileId: string) {
  return {
    guid: voucher.guid,
    key: voucher.key,
    account: archive.account,
    accountKind: archive.accountKind,
    selfBilled: voucher.selfBilled,
    folder: voucher.document?.direction ?? null,
    directionFrom: voucher.directionFrom,
    currency: voucher.currency,
    foreignAmount: voucher.foreignAmount,
    beleginfo: voucher.lines[0]?.info.entries ?? {},
    lines: voucher.lines.map((l) => ({
      stack: l.stack,
      row: l.booking.row,
      account: l.booking.account,
      contraAccount: l.booking.contraAccount,
      side: l.booking.side,
      buKey: l.booking.buKey,
      amount: l.booking.amount,
      currency: l.booking.currency,
      text: l.booking.text,
    })),
    fileName: voucher.document?.fileName ?? null,
    archive: voucher.document?.archive ?? null,
    exportFileId: zipFileId,
    // Belegdaten ohne Beleglink: kein Belegbild im Export; Beleglink ohne Datei: die Datei fehlt im Export
    ohneBelegbild: voucher.guid === null,
    dateiFehlt: voucher.guid !== null && file === null,
  };
}

async function storeVoucher(
  tx: Tx,
  importId: string,
  voucher: SevExportVoucher,
  archive: Archive,
  file: { fileName: string; bytes: Uint8Array } | null,
  zipFileId: string,
): Promise<{ created: boolean; fileAdded: boolean }> {
  const sha256 = file ? await storeFile(file.bytes) : null;
  let [row] = await tx
    .select({ id: schema.lexofficeVouchers.id })
    .from(schema.lexofficeVouchers)
    .where(eq(schema.lexofficeVouchers.lexofficeId, archive.externalId));
  const created = !row;
  if (!row) {
    [row] = await tx
      .insert(schema.lexofficeVouchers)
      .values({
        lexofficeId: archive.externalId,
        source: "sevdesk-export",
        importId,
        type: archive.type,
        direction: archive.direction,
        number: archive.number,
        date: archive.date,
        dueDate: null,
        serviceFrom: null,
        serviceTo: null,
        status: "unchecked",
        contactId: null,
        contactName: archive.contactName,
        currency: "EUR",
        net: archive.net,
        tax: archive.tax,
        gross: archive.gross,
        taxes: [{ rate: archive.rate, net: archive.net, tax: archive.tax }],
        categories: [],
        payment: null,
        remark: voucher.lines[0]?.booking.text ?? "",
        raw: rawOf(voucher, archive, file, zipFileId),
      })
      .returning({ id: schema.lexofficeVouchers.id });
  }
  if (!file || !sha256) return { created, fileAdded: false };
  const added = await tx
    .insert(schema.lexofficeVoucherFiles)
    .values({
      voucherId: row!.id,
      role: "pdf",
      lexofficeFileId: null,
      filename: file.fileName.slice(0, 200),
      mimeType: sniff(file.bytes)?.mimeType ?? "application/octet-stream",
      sha256,
      size: file.bytes.byteLength,
    })
    .onConflictDoNothing({ target: [schema.lexofficeVoucherFiles.voucherId, schema.lexofficeVoucherFiles.sha256] })
    .returning({ id: schema.lexofficeVoucherFiles.id });
  return { created, fileAdded: added.length > 0 };
}
