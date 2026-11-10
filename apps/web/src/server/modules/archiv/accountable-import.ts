import type { AccountableExport, AccountableReceipt, AccountableVoucher } from "@haben/import";
import { count, eq, sql } from "drizzle-orm";
import { db, schema, type Tx } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { sha256Of, storeFile } from "../../storage.ts";
import { assertNoDatevOverlap } from "./archive.ts";
import { progressMessage } from "./lexoffice.ts";
import { categoryRow, documentBlocker, externalId, mimeTypeOf, paymentOf, receiptFilename } from "./accountable-mapping.ts";
import { type AccountableAnalysis, AccountableError, cancelled, OPEN_ITEM_LIMIT, type StagedExport } from "./accountable-state.ts";

/*
 * Der Lauf selbst: Export ins Archiv, Buchungen als Archivbelege mit ihrer Datei.
 *
 * 1. Ein Beleg in Accountable kann auf mehrere Buchungen verteilt sein (etwa zwei Aufwandskonten); dann steht dieselbe GUID
 *    zweimal im Stapel. Weil lexoffice_vouchers.lexoffice_id eindeutig ist, trägt die erste Buchung je GUID den Beleg. Die
 *    weiteren Buchungen derselben GUID bleiben als eigener Archivbeleg mit raw.sameReceiptAs sichtbar und stehen in der
 *    Meldung, statt den Lauf abzubrechen.
 * 2. Buchungen ohne Belegdatei (GUID ohne Datei im Export oder gar kein Beleglink) und Buchungen mit Steuersatz, den Haben
 *    nicht kennt, erhalten keinen Beleg in documents. Dort ist ein Beleg immer eine Datei (sha256 ist Pflicht), und eine
 *    Vorsteuer ohne Beleginhalt anzusetzen hieße raten. Also: archivieren, als offenen Posten melden, nichts anlegen.
 * 3. Ausgangsrechnungen legt der Lauf nicht an (Haben verlangt Positionen, die der DATEV-Stapel nicht enthält). Sie werden
 *    gezählt und im Ergebnis gemeldet.
 * 4. Belege in Haben (documents) legt der Lauf nicht an. Accountable bucht zahlungsbasiert, die Belege sind dort bezahlt;
 *    als gebuchter Beleg mit Zahlart Bank stünde jeder als offene Verbindlichkeit im Bankabgleich, ohne dass es eine
 *    Eröffnungsbuchung gibt (Review #579). Was am Stichtag offen war (Daten.xlsx: nicht bezahlt), übernimmt Schritt 3
 *    „Offene Posten übernehmen“ wie bei Lexoffice und sevDesk, mit Eröffnungsbuchung. Idempotent ist der Lauf über die
 *    GUID (Archivbeleg) und die sha256 (Datei).
 */

export async function runAccountableImport(tx: Tx, importId: string, upload: StagedExport, progress: LexofficeImportProgress) {
  let lastSave = 0;
  const save = async (force = false) => {
    if (!force && Date.now() - lastSave < 1000) return;
    lastSave = Date.now();
    await tx.update(schema.lexofficeImports).set({ progress, updatedAt: new Date() }).where(eq(schema.lexofficeImports.id, importId));
  };
  const stop = () => {
    if (cancelled.has(importId)) throw new AccountableError("Abgebrochen.");
  };
  const accountable = progress.accountable!;

  // 1. Export dauerhaft ins Archiv; dieselbe Datei zählt nicht zweimal
  const archived = await storeExportArchive(tx, importId, upload);
  accountable.archivedFileId = archived.id;
  accountable.archivedAlready = archived.existing;
  await save(true);

  // 2. Je Buchung der Archivbeleg; je Buchung mit Belegdatei der Beleg in documents
  const done = new Set(
    (
      await db.select({ id: schema.lexofficeVouchers.lexofficeId }).from(schema.lexofficeVouchers).where(eq(schema.lexofficeVouchers.source, "accountable"))
    ).map((r) => r.id),
  );
  const openItems: AccountableAnalysis["openItems"] = [];
  const firstOfGuid = new Map<string, string>();
  for (const voucher of upload.mapping.vouchers) {
    stop();
    const key = externalId(voucher);
    const receipt = voucher.guid ? upload.export.receiptByGuid.get(voucher.guid) : undefined;
    const blocker = documentBlocker(voucher, receipt);
    const sameGuid = receipt ? (firstOfGuid.get(receipt.guid) ?? null) : null;
    if (sameGuid) {
      // Buchung derselben Belegdatei; der Beleg wurde mit der ersten Buchung übernommen
      openItems.push({
        number: voucher.invoiceNumber,
        supplier: voucher.supplierName ?? "",
        gross: voucher.gross,
        date: voucher.documentDate,
        reason: `Buchung auf denselben Beleg wie ${sameGuid}; nicht als eigener Beleg angelegt`,
      });
    }
    if (blocker)
      openItems.push({
        number: voucher.invoiceNumber,
        supplier: voucher.supplierName ?? "",
        gross: voucher.gross,
        date: voucher.documentDate,
        reason: blocker,
      });
    if (done.has(key)) {
      progress.skipped += 1;
      await save();
      continue;
    }
    try {
      // Weitere Buchung derselben GUID: die Datei hängt schon an der ersten
      const receiptGuid = receipt?.guid ?? null;
      const sameAs = receiptGuid ? firstOfGuid.get(receiptGuid) : undefined;
      // Eine weitere Buchung derselben GUID ist kein eigener Beleg (lexoffice_id ist eindeutig): Sie steht als Hinweis
      // in der Meldung. Sonst ginge der Beleg mit zwei Buchungen belegt als offener Posten unter.
      const imported = sameAs ? false : await importArchiveVoucher(tx, importId, voucher, receipt ?? null, { withoutFile: blocker !== null });
      if (!imported) {
        progress.skipped += 1;
      } else {
        progress.imported += 1;
        if (receiptGuid) firstOfGuid.set(receiptGuid, key);
        // Die Datei hängt am Archivbeleg; einen Beleg in Haben legt der Lauf nicht an (Entscheidung 4)
        if (receipt) progress.files += 1;
      }
    } catch (error) {
      progress.failed.push({ lexofficeId: key, number: voucher.invoiceNumber, message: progressMessage(error) });
    }
    await save();
  }

  // 3. Was ohne Beleg bleibt und was die Buchung nicht hergibt
  accountable.openItems = openItems.slice(0, OPEN_ITEM_LIMIT);
  accountable.openItemCount = openItems.length;
  accountable.withoutFile = openItems.length;
  accountable.note = noteFor(accountable, [...upload.export.warnings, ...upload.mapping.warnings]);
  await save(true);
}

/** Sätze für die Oberfläche: was nicht nach Haben wandert und warum. */
function noteFor(accountable: AccountableAnalysis, warnings: string[]): string {
  return [
    accountable.privateRows > 0 ? `${accountable.privateRows} Privat- bzw. Umbuchungszeile(n) bleiben ohne Beleg in Haben.` : "",
    accountable.missingReceipts > 0 ? `${accountable.missingReceipts} Buchung(en) verweisen auf einen Beleg, der im Export fehlt.` : "",
    accountable.unknownTaxRows > 0
      ? `${accountable.unknownTaxRows} Buchung(en) haben einen BU-Schlüssel, den Haben nicht kennt; ohne Steueranteil übernommen.`
      : "",
    accountable.openItemCount > 0 ? `${accountable.openItemCount} Buchung(en) ohne Belegdatei stehen nur im Archiv.` : "",
    accountable.invoices.length > 0
      ? `${accountable.invoices.length} Ausgangsrechnung(en) nicht angelegt: Positionen fehlen im DATEV-Stapel; Nummern ${accountable.invoices.map((i) => i.number).join(", ")}.`
      : "",
    ...warnings,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Buchungen des Stapels zeilenweise ablegen. Daran hängen Abgleich
 * ("Jede Buchung mit Belegnummer findet ihren Beleg"), Kontoauszug-Zuordnung und Jahresexport.
 * In Blöcken, damit große Stapel die Parametergrenze von Postgres nicht reißen.
 */
async function storeDatevBookings(tx: Tx, fileId: string, bookings: AccountableExport["stack"]["bookings"]): Promise<void> {
  for (let i = 0; i < bookings.length; i += 1000) {
    await tx.insert(schema.datevBookings).values(
      bookings.slice(i, i + 1000).map((b) => ({
        fileId,
        row: b.row,
        date: b.date,
        amount: b.amount,
        side: b.side,
        currency: b.currency,
        account: b.account,
        contraAccount: b.contraAccount,
        buKey: b.buKey,
        voucherField1: b.voucherField1,
        voucherField2: b.voucherField2,
        text: b.text,
        documentLink: b.documentLink,
        raw: b.raw,
      })),
    );
  }
}

/** Export ins Archiv (archive_files, kind = "datev"); dieselbe Datei verweist nur auf den schon abgelegten Stapel. */
async function storeExportArchive(tx: Tx, importId: string, upload: StagedExport): Promise<{ id: string; existing: boolean }> {
  const sha256 = sha256Of(upload.bytes);
  const [existing] = await db.select({ id: schema.archiveFiles.id }).from(schema.archiveFiles).where(eq(schema.archiveFiles.sha256, sha256));
  if (existing) {
    // Liegt die Datei schon im Archiv, können die Buchungszeilen trotzdem fehlen (etwa nach einem
    // Lauf mit älterem Code). Dann nachziehen, statt den Umzug stumm als erledigt zu melden.
    const [{ n }] = (await tx.select({ n: count() }).from(schema.datevBookings).where(eq(schema.datevBookings.fileId, existing.id))) as [{ n: number }];
    if (n === 0) await storeDatevBookings(tx, existing.id, upload.export.stack.bookings);
    return { id: existing.id, existing: true };
  }
  const header = upload.export.stack.header;
  // Wie beim Ablegen eines Stapels im Archiv: jeder Zeitraum nur einmal. Ein zweiter Export desselben Jahres (andere
  // Bytes, dieselben Buchungen) legte sonst alle Buchungen doppelt ab, und der Abgleich zählte Einnahmen und Ausgaben doppelt.
  const dates = upload.export.stack.bookings.map((b) => b.date).sort();
  const from = header.dateFrom || dates[0];
  const to = header.dateTo || dates.at(-1);
  if (from && to) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('haben.archive.datev'))`);
    await assertNoDatevOverlap(tx, upload.filename, from, to);
  }
  await storeFile(upload.bytes);
  const warnings = [...upload.export.stack.warnings, ...upload.export.warnings];
  const [row] = await tx
    .insert(schema.archiveFiles)
    .values({
      kind: "datev",
      year: header.fiscalYearStart ? Number(header.fiscalYearStart.slice(0, 4)) : null,
      filename: upload.filename.slice(0, 200),
      sha256,
      mimeType: "application/zip",
      size: upload.bytes.byteLength,
      note: `Accountable-Export, Lauf ${importId.slice(0, 8)}`,
      // Accountable-Export; belegt, dass der Stapel schon beim Umzug gelesen wurde (Analyse in der Buchung selbst)
      meta: { header, dateFrom: header.dateFrom, dateTo: header.dateTo, bookings: upload.export.stack.bookings.length, warnings },
    })
    .returning({ id: schema.archiveFiles.id });
  const fileId = row!.id;
  await storeDatevBookings(tx, fileId, upload.export.stack.bookings);
  return { id: fileId, existing: false };
}

/**
 * Archivbeleg je Buchung; die Belegdatei hängt an der ersten Buchung ihrer GUID. true, wenn der Beleg neu ist.
 * Ein zweiter Lauf findet die GUID und legt nichts doppelt an.
 */
async function importArchiveVoucher(
  tx: Tx,
  importId: string,
  voucher: AccountableVoucher,
  receipt: AccountableReceipt | null,
  flags: { withoutFile: boolean; sameReceiptAs?: string },
): Promise<boolean> {
  const key = externalId(voucher);
  // Die Datei liegt unter ihrem Hash; das Schreiben hängt nicht an der Transaktion, das Einfügen schon
  const sha256 = receipt ? await storeFile(receipt.bytes) : null;
  const [known] = await tx.select({ id: schema.lexofficeVouchers.id }).from(schema.lexofficeVouchers).where(eq(schema.lexofficeVouchers.lexofficeId, key));
  if (known) return false;
  const [row] = await tx
    .insert(schema.lexofficeVouchers)
    .values(archiveValues(voucher, importId, key, flags))
    .onConflictDoNothing({ target: schema.lexofficeVouchers.lexofficeId })
    .returning({ id: schema.lexofficeVouchers.id });
  if (!row) return false;
  if (receipt && sha256) await attachReceiptFile(tx, row.id, receipt, sha256);
  return true;
}

function archiveValues(voucher: AccountableVoucher, importId: string, key: string, flags: { withoutFile: boolean; sameReceiptAs?: string }) {
  return {
    lexofficeId: key,
    source: "accountable" as const,
    importId,
    type: "purchaseinvoice",
    direction: "ausgabe" as const,
    number: voucher.invoiceNumber,
    date: voucher.documentDate,
    // Eine Fälligkeit steht nicht im Stapel; Accountable schreibt nur das Belegdatum in Belegfeld 2
    dueDate: null,
    serviceFrom: null,
    serviceTo: null,
    status: "unchecked",
    contactId: null,
    contactName: voucher.supplierName ?? "",
    currency: "EUR",
    net: voucher.net,
    tax: voucher.tax,
    gross: voucher.gross,
    taxes: [{ rate: voucher.taxRate, net: voucher.net, tax: voucher.tax }],
    categories: categoryRow(voucher),
    // Zahlungsstatus aus Daten.xlsx (Q/R): offen bleibt brutto. Ohne die Datei gilt der Beleg als bezahlt,
    // weil der Stapel zahlungsbasiert über 1200 bucht und hier keine offenen Verbindlichkeiten kennt.
    payment: paymentOf(voucher),
    remark: voucher.text,
    raw: {
      row: voucher.row,
      guid: voucher.guid,
      account: voucher.account,
      text: voucher.text,
      taxRate: voucher.taxRate,
      ohneBeleg: flags.withoutFile,
      expenseRow: voucher.expenseRow,
      paid: voucher.paid,
      documentPresent: voucher.documentPresent,
      ...(flags.sameReceiptAs ? { sameReceiptAs: flags.sameReceiptAs } : {}),
    },
  };
}

/** Belegdatei am Archivbeleg; dieselbe Datei hängt nur einmal daran. */
async function attachReceiptFile(tx: Tx, voucherId: string, receipt: AccountableReceipt, sha256: string) {
  await tx
    .insert(schema.lexofficeVoucherFiles)
    .values({
      voucherId,
      role: "pdf",
      lexofficeFileId: null,
      filename: receiptFilename(receipt, null),
      mimeType: mimeTypeOf(receipt),
      sha256,
      size: receipt.bytes.byteLength,
    })
    .onConflictDoNothing({ target: [schema.lexofficeVoucherFiles.voucherId, schema.lexofficeVoucherFiles.sha256] });
}
