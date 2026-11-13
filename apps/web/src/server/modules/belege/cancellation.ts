import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { type PostingLine, type TaxCode, zeilenWieHeute } from "@haben/core";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { isUniqueViolation } from "../../errors.ts";
import { documentBankAllocations, lockCash, reverseAllocationIn, reverseDocumentCashEntry } from "../bank/index.ts";
import { loadOwnAccountNumbers } from "../eigene-konten/index.ts";
import { journalAbJahr } from "../stammdaten/index.ts";
import { openBooks, periodReported, post } from "../buchhaltung/index.ts";
import { belegZeilen } from "./belegbuchung.ts";

export { vatPeriodsOf } from "../buchhaltung/index.ts";
import { DocumentError, type Document } from "./documents.ts";
import { loadSplits } from "./splits.ts";

/*
 * Storno gebuchter Belege (#237), nach dem Muster der Stornorechnung: Die Belegbuchung wird mit vertauschten Seiten
 * zurückgebucht. Ist der Zeitraum der Belegbuchung schon gemeldet (Voranmeldung gesendet oder vermerkt, Jahreserklärung
 * gesendet, Jahr abgeschlossen), am Tag des Stornos: Die abgegebene Voranmeldung bleibt unberührt, die Korrektur steht im
 * laufenden Zeitraum (§ 17 Abs. 1 UStG). Ist er noch offen, im Zeitraum der Belegbuchung: Ein Erfassungsfehler, etwa ein
 * vertauschtes Belegdatum, verschiebt dann keine Vorsteuer in einen Zeitraum, in den sie nicht gehört. Der Beleg selbst
 * ändert sich nicht, er bleibt gesperrt und versiegelt; den Storno hält eine eigene, nur anhängbare Zeile in
 * `document_cancellations` fest. Neu erfasst wird als neuer Entwurf mit derselben Datei.
 */

export const cancellationInputSchema = z.object({
  reason: z.string().trim().max(500).default(""),
  allocationIds: z.array(z.uuid()).default([]),
});

export type CancellationInput = z.input<typeof cancellationInputSchema>;
export type DocumentCancellation = typeof schema.documentCancellations.$inferSelect;

/** Was gegen einen Storno spricht; leere Liste = stornierbar. Bank- und Kassenstand prüft cancelDocument selbst. */
export function cancellationIssues(doc: Pick<Document, "lockedAt" | "lexofficeVoucherId" | "category">): string[] {
  if (!doc.lockedAt) return ["Der Beleg ist noch nicht gebucht; einen Entwurf änderst oder löschst du einfach."];
  if (doc.lexofficeVoucherId) return ["Aus einem Umzug übernommene Belege sind im bisherigen Programm angemeldet und lassen sich hier nicht stornieren."];
  // Die Anlage aus dem Beleg bleibt im Verzeichnis und würde weiter abgeschrieben; ihr Abgang gehört ins Anlagenverzeichnis
  if (doc.category === "anlage") return ["Belege zu Anlagegütern lassen sich nicht stornieren. Erfasse stattdessen den Abgang im Anlagenverzeichnis."];
  return [];
}

/** Nach der Rücknahme der Bankzuordnungen darf keine separate Ausbuchung am Beleg verbleiben. */
async function settled(tx: Tx, documentId: string): Promise<number> {
  const [row] = await tx.execute<{ settled: string }>(sql`
    select coalesce((select sum(amount) from allocations where document_id = ${documentId}), 0)
         + coalesce((select sum(amount) from write_offs where document_id = ${documentId}), 0)
         + coalesce((select sum(amount) from document_settlements where document_id = ${documentId}), 0) as settled`);
  return Number(row?.settled ?? 0);
}

/** Bestätigter Umfang; die Gegenzeilen bleiben in der withActor-Transaktion des Belegstornos. */
async function reverseConfirmedAllocations(tx: Tx, doc: Pick<Document, "id" | "payment">, allocationIds: string[]) {
  const allocations = doc.payment === "bank" ? await documentBankAllocations(doc.id, tx) : [];
  if (allocations.length > 0 && allocationIds.length === 0) {
    throw new DocumentError("Der Beleg ist schon einer Zahlung zugeordnet. Hebe erst im Bankabgleich die Zuordnung auf, dann stornierst du ihn.");
  }
  const expected = allocations
    .map((a) => a.id)
    .sort()
    .join();
  if ([...allocationIds].sort().join() !== expected) {
    throw new DocumentError("Die Bankzuordnungen haben sich geändert. Lade den Beleg neu und bestätige den aktuellen Umfang.");
  }
  const groups = new Map(allocations.map((a) => [a.splitId ?? a.id, a.id]));
  // Originale bleiben nachvollziehbar (§ 146 Abs. 4 AO); scheitert der Storno, werden auch die Bankgegenzeilen zurückgerollt.
  // https://www.gesetze-im-internet.de/ao_1977/__146.html
  for (const allocationId of groups.values()) await reverseAllocationIn(tx, allocationId);
}

/** Die Buchung des Belegs; ein Storno hat reverses_id und zählt nicht */
async function documentEntry(tx: Db | Tx, documentId: string) {
  const [entry] = await tx
    .select()
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.sourceType, "document"), eq(schema.journalEntries.sourceId, documentId), isNull(schema.journalEntries.reversesId)));
  if (!entry) throw new DocumentError("Zum Beleg gibt es keine Buchung.");
  return entry;
}

/**
 * Buchungsdatum der Gegenbuchung. Ist der Zeitraum der Belegbuchung noch nicht gemeldet, ihr Datum; sonst der Tag des
 * Stornos, nie vor dem Belegdatum (sonst minderte der Storno einen Zeitraum, in dem der Beleg noch gar nicht zählt).
 * Bar aus der Kasse immer am Tag des Stornos: Das Kassenbuch wird zeitnah und in der Reihenfolge der Tage geführt, eine
 * zurückdatierte Gegenzeile bekäme eine Nummer hinter späteren Zeilen.
 */
export async function cancellationDate(
  q: Db | Tx,
  input: { entryDate: string; documentDate: string | null; payment: string },
  todayDate: string,
): Promise<string> {
  const current = input.documentDate && input.documentDate > todayDate ? input.documentDate : todayDate;
  if (input.payment === "kasse" || input.entryDate >= current) return current;
  return (await periodReported(q, input.entryDate)) ? current : input.entryDate;
}

/** Das Datum, das ein Storno heute bekäme; für den Hinweis vor dem Stornieren. Null ohne Belegbuchung. */
export async function plannedCancellationDate(id: string, todayDate: string): Promise<string | null> {
  const [doc] = await db
    .select({ documentDate: schema.documents.documentDate, payment: schema.documents.payment })
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  if (!doc) return null;
  const entry = await documentEntry(db, id).catch(() => null);
  if (!entry) return null;
  return cancellationDate(db, { entryDate: entry.date, documentDate: doc.documentDate, payment: doc.payment }, todayDate);
}

/**
 * Die Zeilen des Belegs, wie Haben ihn heute bucht; null, wenn die heutige Buchungslogik ihn nicht mehr annimmt (etwa eine
 * später verschärfte Regel). Dann bleibt es beim Storno der gebuchten Zeilen.
 */
function heutigeBelegZeilen(
  doc: Document,
  amounts: { taxRate: number; net: number; tax: number }[],
  splits: Awaited<ReturnType<typeof loadSplits>>,
  books: Awaited<ReturnType<typeof openBooks>>,
  eigene: ReadonlyMap<string, string>,
): PostingLine[] | null {
  try {
    return belegZeilen(doc, amounts, splits, books, doc.vorsteuerAbzug, eigene);
  } catch {
    return null;
  }
}

/**
 * Storniert einen gebuchten Beleg: Gegenbuchung im noch offenen Zeitraum der Belegbuchung, sonst am Tag des Stornos
 * (siehe cancellationDate), bei Barzahlung eine Gegenzeile im Kassenbuch, dazu die Zeile in `document_cancellations`.
 * Ein abgeschlossenes Jahr lehnt das Hauptbuch ab.
 */
export async function cancelDocument(actor: string, id: string, input: CancellationInput, todayDate: string): Promise<DocumentCancellation> {
  const { reason, allocationIds } = cancellationInputSchema.parse(input);
  return withActor(actor, async (tx) => {
    const [peek] = await tx.select({ payment: schema.documents.payment }).from(schema.documents).where(eq(schema.documents.id, id));
    if (!peek) throw new DocumentError("Beleg nicht gefunden.");
    // Kasse vor der ersten Änderung sperren, wie beim Buchen des Belegs (siehe lockCash)
    if (peek.payment === "kasse") await lockCash(tx);
    const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, id)).for("update");
    if (!doc) throw new DocumentError("Beleg nicht gefunden.");
    const issues = cancellationIssues(doc);
    if (issues.length > 0) throw new DocumentError(issues[0]!);
    const [already] = await tx
      .select({ id: schema.documentCancellations.id })
      .from(schema.documentCancellations)
      .where(eq(schema.documentCancellations.documentId, id));
    if (already) throw new DocumentError("Der Beleg ist bereits storniert.");
    await reverseConfirmedAllocations(tx, doc, allocationIds);
    if (doc.payment === "bank" && (await settled(tx, id)) !== 0) {
      throw new DocumentError("Dem Beleg ist noch eine separate Ausbuchung zugeordnet. Hebe diese im Bankabgleich auf, dann stornierst du ihn.");
    }

    const books = await openBooks(tx);
    const original = await documentEntry(tx, id);
    // Gleiche Kontonummern bedeuten in einem anderen Kontenrahmen etwas anderes
    if (original.kontenrahmen !== books.kontenrahmen) {
      throw new DocumentError(
        `Der Beleg ist im Kontenrahmen ${original.kontenrahmen} gebucht, eingestellt ist jetzt ${books.kontenrahmen}. Stornieren geht nach dem Wechsel nicht mehr.`,
      );
    }
    const lines = await tx
      .select({
        account: schema.journalLines.account,
        debit: schema.journalLines.debit,
        credit: schema.journalLines.credit,
        taxCode: schema.journalLines.taxCode,
      })
      .from(schema.journalLines)
      .where(eq(schema.journalLines.entryId, original.id))
      .orderBy(asc(schema.journalLines.id));
    // Vor dem Stichjahr gebucht: im heutigen Format, wenn es auf jedem Konto dasselbe ergibt (zeilenWieHeute)
    const gebucht: PostingLine[] = lines.map((l) => ({ ...l, taxCode: l.taxCode as TaxCode | null }));
    const vorStichjahr = Number(original.date.slice(0, 4)) < (await journalAbJahr(tx));
    const amounts = vorStichjahr ? await tx.select().from(schema.documentAmounts).where(eq(schema.documentAmounts.documentId, id)) : [];
    const zeilen = vorStichjahr
      ? zeilenWieHeute(gebucht, heutigeBelegZeilen(doc, amounts, await loadSplits(id, tx), books, await loadOwnAccountNumbers(tx)) ?? [])
      : gebucht;
    const date = await cancellationDate(tx, { entryDate: original.date, documentDate: doc.documentDate, payment: doc.payment }, todayDate);
    const journalEntryId = await post(tx, books, {
      date,
      description: `Storno: ${original.description}`,
      sourceType: "document",
      sourceId: id,
      reversesId: original.id,
      // Soll und Haben getauscht, Steuerschlüssel wie gebucht
      lines: zeilen.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit, taxCode: l.taxCode })),
    });
    if (doc.payment === "kasse") {
      await reverseDocumentCashEntry(tx, {
        documentId: id,
        date,
        text: `Storno: ${doc.supplierName}${doc.invoiceNumber ? ` · ${doc.invoiceNumber}` : ""}`,
        journalEntryId,
      });
    }
    const [row] = await tx.insert(schema.documentCancellations).values({ documentId: id, date, reason, journalEntryId }).returning();
    return row!;
  });
}

/** Storno eines Belegs und, falls schon neu erfasst, der neue Entwurf */
export async function documentCancellation(id: string): Promise<{ cancellation: DocumentCancellation | null; reentryId: string | null }> {
  const [cancellation] = await db.select().from(schema.documentCancellations).where(eq(schema.documentCancellations.documentId, id));
  if (!cancellation) return { cancellation: null, reentryId: null };
  const [reentry] = await db.select({ id: schema.documents.id }).from(schema.documents).where(eq(schema.documents.replacesDocumentId, id));
  return { cancellation, reentryId: reentry?.id ?? null };
}

/**
 * Neu erfassen: ein Entwurf mit derselben Datei und den Feldern des stornierten Belegs, mit Beträgen und Aufteilung, zum
 * Korrigieren und neu Buchen.
 * Je storniertem Beleg einer; gibt es ihn schon, liefert Haben ihn.
 */
export async function reenterDocument(actor: string, id: string): Promise<string> {
  const [cancellation] = await db
    .select({ id: schema.documentCancellations.id })
    .from(schema.documentCancellations)
    .where(eq(schema.documentCancellations.documentId, id));
  if (!cancellation) throw new DocumentError("Neu erfassen geht nur bei einem stornierten Beleg.");
  // Eindeutig je storniertem Beleg (documents_replaces)
  const existing = async () => (await db.select({ id: schema.documents.id }).from(schema.documents).where(eq(schema.documents.replacesDocumentId, id)))[0]?.id;
  const known = await existing();
  if (known) return known;
  try {
    return await withActor(actor, async (tx) => {
      const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, id));
      const amounts = await tx.select().from(schema.documentAmounts).where(eq(schema.documentAmounts.documentId, id));
      const d = doc!;
      const [created] = await tx
        .insert(schema.documents)
        .values({
          sha256: d.sha256,
          filename: d.filename,
          mimeType: d.mimeType,
          size: d.size,
          extractedBy: d.extractedBy,
          supplierName: d.supplierName,
          supplierUstId: d.supplierUstId,
          supplierContactId: d.supplierContactId,
          invoiceNumber: d.invoiceNumber,
          documentDate: d.documentDate,
          dueDate: d.dueDate,
          category: d.category,
          ownAccountId: d.ownAccountId,
          payment: d.payment,
          note: d.note,
          currency: d.currency,
          exchangeRate: d.exchangeRate,
          exchangeRateSource: d.exchangeRateSource,
          exchangeRateDate: d.exchangeRateDate,
          net: d.net,
          tax: d.tax,
          gross: d.gross,
          asset: d.asset,
          privateShare: d.privateShare,
          reverseCharge: d.reverseCharge,
          // Die Neuerfassung mindert dasselbe Entgelt; die Angabe „erstattet bereits Bezahltes“ bleibt (#786)
          erstattetBezahltes: d.erstattetBezahltes,
          replacesDocumentId: id,
        })
        .returning({ id: schema.documents.id });
      if (amounts.length > 0) {
        await tx.insert(schema.documentAmounts).values(
          amounts.map((a) => ({
            documentId: created!.id,
            taxRate: a.taxRate,
            net: a.net,
            tax: a.tax,
            originalNet: a.originalNet,
            originalTax: a.originalTax,
          })),
        );
      }
      // Aufteilung (#271) wie gebucht, mit derselben Vorsteuer je Zeile
      const splits = await loadSplits(id, tx);
      if (splits.length > 0) {
        await tx.insert(schema.documentSplits).values(splits.map(({ id: _id, documentId: _documentId, ...line }) => ({ documentId: created!.id, ...line })));
      }
      return created!.id;
    });
  } catch (error) {
    // Gleichzeitig neu erfasst: der andere Entwurf gilt
    if (!isUniqueViolation(error, "documents_replaces")) throw error;
    return (await existing())!;
  }
}
