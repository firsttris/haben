/**
 * Lauf der Dauerbelege: legt zu jedem fälligen Termin einen Beleg „Zu prüfen“ an, nach dem Muster der wiederkehrenden
 * Rechnungen (rechnungen/recurring.ts, docs/architektur.md › Hintergrundarbeit). Je Termin eine Transaktion: Vorlage
 * sperren, Beleg anlegen, nächsten Termin weiterrücken. Je Vorlage und Periode entsteht höchstens ein Beleg (eindeutiger
 * Index documents_recurring_period), auch nach einem Neustart oder bei zwei gleichzeitigen Läufen.
 */
import {
  dauerbelegFaellig,
  dauerbelegPeriode,
  dauerbelegSummen,
  documentOpen,
  folgeTermin,
  suggestMatches,
  type MatchTransaction,
  type OpenItem,
  type RecurringInterval,
  type Suggestion,
} from "@haben/core";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { INTERNAL_ERROR, userMessage } from "../../errors.ts";
import { allocateIn } from "../bank/index.ts";
import { DauerbelegError, type Dauerbeleg } from "./dauerbelege.ts";
import { bookDocumentIn } from "./documents.ts";

/** Wer die Belege eines Laufs im Audit-Log angelegt hat */
export const DAUERBELEG_ACTOR = "system:dauerbelege";

export interface DauerbelegLauf {
  created: number;
  errors: string[];
}

/** 2026-11-01 → 01.11.2026 */
const deutsch = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Notiz am Beleg: woher er stammt und welche Datei ihn belegt */
function noteFor(vorlage: Dauerbeleg, termin: string): string {
  const lines = [
    `Aus Dauerbeleg „${vorlage.name}“, Termin ${deutsch(termin)}. Beleg: ${vorlage.filename} (SHA-256 ${vorlage.sha256.slice(0, 12)}…).`,
    vorlage.taxShown ? "" : "Das Dokument weist keine Umsatzsteuer aus; ohne Steuerausweis keine Vorsteuer.",
    vorlage.note,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Legt den Beleg zum Termin an; false, wenn es für die Periode schon einen gibt */
async function insertBeleg(tx: Tx, vorlage: Dauerbeleg, termin: string): Promise<boolean> {
  const totals = dauerbelegSummen(vorlage.amounts);
  const [created] = await tx
    .insert(schema.documents)
    .values({
      sha256: vorlage.sha256,
      filename: vorlage.filename,
      mimeType: vorlage.mimeType,
      size: vorlage.size,
      supplierName: vorlage.supplierName,
      supplierUstId: vorlage.supplierUstId,
      supplierContactId: vorlage.supplierContactId,
      invoiceNumber: vorlage.reference,
      documentDate: termin,
      dueDate: dauerbelegFaellig(termin, vorlage.dueDays),
      category: vorlage.category,
      payment: vorlage.payment,
      privateShare: vorlage.privateShare,
      note: noteFor(vorlage, termin),
      ...totals,
      recurringDocumentId: vorlage.id,
      recurringPeriod: dauerbelegPeriode(termin),
    })
    .onConflictDoNothing({ target: [schema.documents.recurringDocumentId, schema.documents.recurringPeriod] })
    .returning({ id: schema.documents.id });
  if (!created) return false;
  const rows = vorlage.amounts.filter((a) => a.net !== 0 || a.tax !== 0);
  if (rows.length > 0) await tx.insert(schema.documentAmounts).values(rows.map((a) => ({ documentId: created.id, ...a })));
  return true;
}

/**
 * Ein Termin einer Vorlage: null, wenn nichts mehr fällig ist. Die Sperre der Vorlage reiht gleichzeitige Läufe; der
 * zweite sieht danach den weitergerückten Termin.
 */
async function runTermin(id: string, heute: string): Promise<{ created: boolean } | null> {
  return withActor(DAUERBELEG_ACTOR, async (tx) => {
    const [vorlage] = await tx.select().from(schema.recurringDocuments).where(eq(schema.recurringDocuments.id, id)).for("update");
    if (vorlage?.status !== "aktiv" || vorlage.nextDate > heute) return null;
    const termin = vorlage.nextDate;
    if (vorlage.endDate !== null && termin > vorlage.endDate) {
      await tx.update(schema.recurringDocuments).set({ status: "beendet", lastRunAt: new Date() }).where(eq(schema.recurringDocuments.id, id));
      return null;
    }
    const created = await insertBeleg(tx, vorlage, termin);
    const nextDate = folgeTermin(termin, { intervalMonths: vorlage.intervalMonths as RecurringInterval, anchorDay: vorlage.anchorDay });
    const ended = vorlage.endDate !== null && nextDate > vorlage.endDate;
    await tx
      .update(schema.recurringDocuments)
      .set({ nextDate, status: ended ? "beendet" : "aktiv", lastRunAt: new Date(), lastError: null })
      .where(eq(schema.recurringDocuments.id, id));
    return { created };
  });
}

function describe(error: unknown): string {
  const message = userMessage(error);
  if (message === undefined) console.error("Dauerbeleg:", error);
  return message ?? INTERNAL_ERROR;
}

/** Legt für alle fälligen Termine Belege an; verpasste Termine mit ihrem Datum */
export async function runDueDauerbelege(heute: string): Promise<DauerbelegLauf> {
  const result: DauerbelegLauf = { created: 0, errors: [] };
  const due = await db
    .select({ id: schema.recurringDocuments.id, name: schema.recurringDocuments.name })
    .from(schema.recurringDocuments)
    .where(and(eq(schema.recurringDocuments.status, "aktiv"), lte(schema.recurringDocuments.nextDate, heute)));
  for (const vorlage of due) {
    try {
      // Höchstens zehn Jahre Monate nachholen, damit ein falsches Startdatum den Lauf nicht endlos beschäftigt
      for (let i = 0; i < 120; i++) {
        const step = await runTermin(vorlage.id, heute);
        if (!step) break;
        if (step.created) result.created++;
      }
    } catch (error) {
      const lastError = describe(error);
      result.errors.push(`${vorlage.name}: ${lastError}`);
      await withActor(DAUERBELEG_ACTOR, (tx) =>
        tx.update(schema.recurringDocuments).set({ lastRunAt: new Date(), lastError }).where(eq(schema.recurringDocuments.id, vorlage.id)),
      ).catch((e: unknown) => console.error("Dauerbeleg: Fehler nicht gespeichert", e));
    }
  }
  return result;
}

/** Ungebuchte Belege aus Dauerbelegen, die über das Geschäftskonto bezahlt werden: Kandidaten für den Bankabgleich */
export async function pendingDauerbelegItems(): Promise<OpenItem[]> {
  const rows = await db
    .select({
      id: schema.documents.id,
      invoiceNumber: schema.documents.invoiceNumber,
      documentDate: schema.documents.documentDate,
      dueDate: schema.documents.dueDate,
      gross: schema.documents.gross,
      supplierName: schema.documents.supplierName,
      contactIban: schema.contacts.iban,
    })
    .from(schema.documents)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.documents.supplierContactId))
    .where(and(isNotNull(schema.documents.recurringDocumentId), eq(schema.documents.status, "neu"), eq(schema.documents.payment, "bank")));
  return rows
    .filter((r) => r.gross !== 0 && r.documentDate)
    .map((r) => ({
      type: "document" as const,
      id: r.id,
      number: r.invoiceNumber,
      date: r.documentDate!,
      dueDate: r.dueDate,
      open: documentOpen(r.gross, 0),
      partyName: r.supplierName,
      partyIbans: r.contactIban ? [r.contactIban] : [],
    }));
}

/**
 * Vorschläge aus ungebuchten Dauerbelegen für einen Umsatz: nur Treffer mit passendem Betrag, damit ein Klick nicht
 * einen falschen Beleg bucht
 */
export async function dauerbelegSuggestions(tx: MatchTransaction): Promise<Suggestion[]> {
  const items = await pendingDauerbelegItems();
  return suggestMatches(tx, items).filter((s) => s.amount === s.item.open);
}

export const bookAndAllocateSchema = z.object({ documentId: z.uuid(), transactionId: z.uuid() });

/**
 * Bankabgleich: einen Beleg aus einem Dauerbeleg auf Klick buchen und dem Umsatz zuordnen, in einer Transaktion.
 * Scheitert die Zuordnung (anderer Betrag, Umsatz schon zugeordnet), bleibt der Beleg ungebucht; sonst stünde die
 * Vorsteuer im Journal, obwohl der Nutzer nur eine Fehlermeldung sieht.
 */
export async function bookAndAllocateDauerbeleg(actor: string, input: z.infer<typeof bookAndAllocateSchema>): Promise<void> {
  await withActor(actor, async (tx) => {
    // Sperren wie bei jeder Zuordnung: erst der Umsatz, dann der Beleg, beides vor dem ersten Schreiben (Audit-Kette)
    await tx.select({ id: schema.bankTransactions.id }).from(schema.bankTransactions).where(eq(schema.bankTransactions.id, input.transactionId)).for("update");
    const [doc] = await tx
      .select({ status: schema.documents.status, gross: schema.documents.gross, recurringDocumentId: schema.documents.recurringDocumentId })
      .from(schema.documents)
      .where(eq(schema.documents.id, input.documentId))
      .for("update");
    if (!doc?.recurringDocumentId) throw new DauerbelegError("Der Beleg stammt nicht aus einem Dauerbeleg.");
    if (doc.status !== "gebucht") await bookDocumentIn(tx, input.documentId);
    await allocateIn(tx, { kind: "document", transactionId: input.transactionId, documentId: input.documentId, amount: documentOpen(doc.gross, 0) });
  });
}
