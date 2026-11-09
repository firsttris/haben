import { randomBytes } from "node:crypto";
import { addDays, collectionDateFor, invoiceOpen, pain008, type Cents, type SepaDirectDebitBatch, type SepaSequence } from "@haben/core";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { findMandate, loadCompany, type Mandate } from "../stammdaten/index.ts";
import { BankError, invoicePayments } from "./bank.ts";
import { invoicesWithPendingDirectDebit } from "./lastschrift-abgleich.ts";

/**
 * Lastschriften als pain.008-Sammeldatei aus fälligen Rechnungen mit Zahlungsart Lastschrift (#445). Gebucht wird beim
 * Erzeugen nichts: Die Rechnungen bleiben offen, bis der Bankabgleich die Sammelgutschrift zuordnet. Nach einer
 * Rücklastschrift steht die Rechnung wieder zur Wahl. Jede Lastschrift
 * steht in sepa_direct_debit_items und zählt für den Verfall des Mandats nach 36 Monaten (Rulebook Kap. 4.2: ab dem
 * letzten eingereichten Einzug).
 *
 * Eingereicht wird frühestens 14 Kalendertage vor Fälligkeit (SDD Core Rulebook v1.2, Kap. 4.3.4); die Fälligkeit der
 * Lastschrift ist die der Rechnung, frühestens der zweite TARGET-Tag nach heute (collectionDateFor).
 */

/** Wie viele Kalendertage vor Fälligkeit eine Lastschrift höchstens eingereicht wird (Rulebook Kap. 4.3.4) */
const EARLIEST_DAYS = 14;

export interface DirectDebitCandidate {
  invoiceId: string;
  number: string;
  customerName: string;
  issueDate: string;
  dueDate: string;
  /** Fälligkeit der Lastschrift (ReqdColltnDt) */
  collectionDate: string;
  open: Cents;
  mandateId: string;
  mandateReference: string;
  scheme: "CORE" | "B2B";
  sequence: SepaSequence;
  /** Warum die Rechnung nicht in die Datei kann */
  problem: string | null;
}

const germanDate = (day: string) => day.split("-").reverse().join(".");

/** Letzter Einzug aus Haben je Mandat (Fälligkeit der jüngsten Lastschrift), auch wenn er zurückgegeben wurde */
export async function lastCollections(mandateIds: string[], q: Db | Tx = db): Promise<Map<string, string>> {
  if (mandateIds.length === 0) return new Map();
  const rows = await q
    .select({ mandateId: schema.sepaDirectDebitItems.mandateId, last: max(schema.sepaDirectDebitItems.collectionDate) })
    .from(schema.sepaDirectDebitItems)
    .where(inArray(schema.sepaDirectDebitItems.mandateId, mandateIds))
    .groupBy(schema.sepaDirectDebitItems.mandateId);
  return new Map(rows.flatMap((r) => (r.last ? [[r.mandateId, r.last] as const] : [])));
}

/** Erste Lastschrift aus Haben auf ein neues Mandat: FRST, sonst RCUR (FRST ist optional, EPC132-17 v5.1, Kap. 2.7) */
function sequenceFor(mandate: Mandate, collected: Set<string>): SepaSequence {
  return mandate.firstSequence === "FRST" && !collected.has(mandate.id) ? "FRST" : "RCUR";
}

const STATUS_TEXT = { abgelaufen: "abgelaufen", widerrufen: "widerrufen", "noch-nicht": "noch nicht unterschrieben" } as const;

function candidateProblem(mandate: Mandate | null, reference: string, collectionDate: string, dueDate: string, today: string): string | null {
  if (!mandate) return "Mandat nicht gefunden";
  if (mandate.status.art !== "gueltig") return `Mandat ${reference} ist am ${germanDate(collectionDate)} ${STATUS_TEXT[mandate.status.art]}`;
  const earliest = addDays(dueDate, -EARLIEST_DAYS);
  if (today < earliest) return `Erst ab ${germanDate(earliest)} einzureichen, 14 Tage vor Fälligkeit`;
  return null;
}

/** Offene Rechnungen mit Zahlungsart Lastschrift, die noch nicht eingereicht sind; früheste Fälligkeit zuerst */
export async function directDebitCandidates(today: string, q: Db | Tx = db): Promise<DirectDebitCandidate[]> {
  const invoices = await q
    .select({
      id: schema.invoices.id,
      number: schema.invoices.number,
      kind: schema.invoices.kind,
      gross: schema.invoices.gross,
      issueDate: schema.invoices.issueDate,
      dueDate: schema.invoices.dueDate,
      buyer: schema.invoices.buyer,
      mandateId: schema.invoices.sepaMandateId,
      cancelled: sql<boolean>`exists (select 1 from invoices s where s.kind = 'storno' and s.status = 'final' and s.corrects_id = ${schema.invoices.id})`,
    })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.status, "final"), eq(schema.invoices.paymentMethod, "lastschrift")))
    // Die früheste Rechnung auf ein neues Mandat ist die Erstlastschrift
    .orderBy(asc(schema.invoices.dueDate), asc(schema.invoices.number));
  // Eingereicht und nicht zurückgegeben: nicht noch einmal einziehen (lastschrift-abgleich.ts)
  const pending = await invoicesWithPendingDirectDebit(q);
  const paid = await invoicePayments(
    invoices.map((i) => i.id),
    q,
  );
  const collected = new Set(
    (
      await lastCollections(
        invoices.flatMap((i) => (i.mandateId ? [i.mandateId] : [])),
        q,
      )
    ).keys(),
  );
  const candidates: DirectDebitCandidate[] = [];
  for (const inv of invoices) {
    const open = invoiceOpen({ status: "final", kind: inv.kind, gross: inv.gross, paid: paid.get(inv.id) ?? 0, cancelled: inv.cancelled });
    if (open <= 0 || !inv.mandateId || pending.has(inv.id)) continue;
    const collectionDate = collectionDateFor(inv.dueDate, today);
    const mandate = await findMandate(inv.mandateId, collectionDate, q);
    const reference = mandate?.reference ?? "";
    const sequence = mandate ? sequenceFor(mandate, collected) : "RCUR";
    // Weitere Rechnungen auf dasselbe neue Mandat in derselben Datei sind Folgelastschriften
    if (mandate) collected.add(mandate.id);
    candidates.push({
      invoiceId: inv.id,
      number: inv.number!,
      customerName: inv.buyer?.name ?? "",
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      collectionDate,
      open,
      mandateId: inv.mandateId,
      mandateReference: reference,
      scheme: mandate?.scheme ?? "CORE",
      sequence,
      problem: candidateProblem(mandate, reference, collectionDate, inv.dueDate, today),
    });
  }
  return candidates.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number));
}

export const directDebitFileSchema = z.object({
  bankAccountId: z.uuid(),
  invoiceIds: z
    .array(z.uuid())
    .min(1, "Keine Rechnung ausgewählt")
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, "Eine Rechnung ist doppelt ausgewählt"),
});

export type DirectDebitFileInput = z.infer<typeof directDebitFileSchema>;

/** Kennung der Datei und der Lastschriften: HABEN- und 16 Hex-Ziffern, im Zeichensatz des Schemas und eindeutig */
const newId = () => `HABEN-${randomBytes(8).toString("hex").toUpperCase()}`;

const berlinTime = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type Planned = { candidate: DirectDebitCandidate; mandate: Mandate; sequence: SepaSequence; endToEndId: string; remittance: string };

/**
 * Sequenz nach der Auswahl, nicht nach der ganzen Liste: Die früheste gewählte Lastschrift auf ein neues Mandat ist FRST,
 * auch wenn eine frühere Rechnung derselben Kunden nicht gewählt ist.
 */
async function withSequences(planned: Omit<Planned, "sequence">[], q: Tx): Promise<Planned[]> {
  const collected = new Set((await lastCollections([...new Set(planned.map((p) => p.mandate.id))], q)).keys());
  const ordered = [...planned].sort(
    (a, b) => a.candidate.collectionDate.localeCompare(b.candidate.collectionDate) || a.candidate.number.localeCompare(b.candidate.number),
  );
  return ordered.map((p) => {
    const sequence = sequenceFor(p.mandate, collected);
    collected.add(p.mandate.id);
    return { ...p, sequence };
  });
}

/** Je Fälligkeit, Verfahren und Sequenz ein Sammler */
function batchesOf(planned: Planned[], messageId: string): (SepaDirectDebitBatch & { items: Planned[] })[] {
  const groups = new Map<string, Planned[]>();
  for (const p of planned) {
    const key = `${p.candidate.collectionDate}|${p.candidate.scheme}|${p.sequence}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.values()].map((items, i) => ({
    paymentInfoId: `${messageId}-${i + 1}`,
    scheme: items[0]!.candidate.scheme,
    sequence: items[0]!.sequence,
    collectionDate: items[0]!.candidate.collectionDate,
    items,
    transactions: items.map((p) => ({
      endToEndId: p.endToEndId,
      amount: p.candidate.open,
      mandate: { reference: p.mandate.reference, signedOn: p.mandate.signedOn },
      debtor: { name: p.mandate.debtorName, iban: p.mandate.debtorIban, ...(p.mandate.debtorBic ? { bic: p.mandate.debtorBic } : {}) },
      remittance: p.remittance,
    })),
  }));
}

/** Erzeugt die pain.008-Datei für die gewählten Rechnungen und hält sie fest (sepa_direct_debits, sepa_direct_debit_items) */
export async function createDirectDebitFile(actor: string, input: DirectDebitFileInput, now = new Date()): Promise<{ id: string; filename: string }> {
  const today = berlinTime.format(now).slice(0, 10);
  const [account] = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, input.bankAccountId));
  if (!account?.iban || account.purpose === "zahlungsdienstleister") throw new BankError("Bitte ein Bankkonto mit IBAN als Gläubigerkonto wählen.");
  const creditorIban = account.iban;
  const company = await loadCompany();
  if (!company.glaeubigerId) throw new BankError("Die Gläubiger-ID fehlt in den Firmendaten.");
  const creditorName = (company.kontoinhaber || company.name).trim();
  if (creditorName === "") throw new BankError("Der Firmenname fehlt in den Einstellungen; er steht als Gläubiger in der Datei.");

  return withActor(actor, async (tx) => {
    // Gleichzeitige Aufrufe nacheinander: sonst sehen beide dieselbe Rechnung als offen und ziehen sie doppelt ein
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('haben.lastschriftdatei'))`);
    const candidates = new Map((await directDebitCandidates(today, tx)).map((c) => [c.invoiceId, c]));
    const problems: string[] = [];
    const chosen: Omit<Planned, "sequence">[] = [];
    for (const id of input.invoiceIds) {
      const candidate = candidates.get(id);
      if (!candidate) {
        problems.push("Eine gewählte Rechnung ist nicht mehr offen oder schon eingereicht.");
        continue;
      }
      const mandate = await findMandate(candidate.mandateId, candidate.collectionDate, tx);
      if (candidate.problem || !mandate) {
        problems.push(`${candidate.customerName}: ${candidate.problem}`);
        continue;
      }
      chosen.push({ candidate, mandate, endToEndId: newId(), remittance: `Rechnung ${candidate.number}` });
    }
    if (problems.length > 0) throw new BankError(problems.join(" "));
    const planned = await withSequences(chosen, tx);

    const messageId = newId();
    const batches = batchesOf(planned, messageId);
    const result = pain008({
      messageId,
      createdAt: berlinTime.format(now).replace(" ", "T"),
      // BIC nur, wenn sie in den Firmendaten zu genau diesem Konto steht; sonst NOTPROVIDED
      creditor: {
        name: creditorName,
        iban: creditorIban,
        ...(company.iban.replace(/\s+/g, "").toUpperCase() === creditorIban && company.bic ? { bic: company.bic } : {}),
      },
      creditorId: company.glaeubigerId,
      batches,
    });
    if (!result.ok) throw new BankError(result.problems.join("; "));

    const [file] = await tx
      .insert(schema.sepaDirectDebits)
      .values({ bankAccountId: account.id, messageId, numberOfTransactions: result.numberOfTransactions, controlSum: result.controlSum, xml: result.xml })
      .returning({ id: schema.sepaDirectDebits.id });
    await tx.insert(schema.sepaDirectDebitItems).values(
      batches.flatMap((batch) =>
        batch.items.map((p) => ({
          directDebitId: file!.id,
          invoiceId: p.candidate.invoiceId,
          mandateId: p.mandate.id,
          paymentInfoId: batch.paymentInfoId,
          endToEndId: p.endToEndId,
          scheme: batch.scheme,
          sequence: batch.sequence,
          collectionDate: batch.collectionDate,
          amount: p.candidate.open,
          debtorName: p.mandate.debtorName,
          debtorIban: p.mandate.debtorIban,
          remittance: p.remittance,
        })),
      ),
    );
    return { id: file!.id, filename: `${messageId}.xml` };
  });
}

/** Erzeugte Lastschriftdateien, neueste zuerst */
export async function listDirectDebitFiles(limit = 50) {
  return db
    .select({
      id: schema.sepaDirectDebits.id,
      messageId: schema.sepaDirectDebits.messageId,
      numberOfTransactions: schema.sepaDirectDebits.numberOfTransactions,
      controlSum: schema.sepaDirectDebits.controlSum,
      createdAt: schema.sepaDirectDebits.createdAt,
      accountName: schema.bankAccounts.name,
      collectionDate: sql<string>`(select min(collection_date) from sepa_direct_debit_items i where i.direct_debit_id = ${schema.sepaDirectDebits.id})`,
    })
    .from(schema.sepaDirectDebits)
    .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, schema.sepaDirectDebits.bankAccountId))
    .orderBy(desc(schema.sepaDirectDebits.createdAt))
    .limit(limit);
}

/** Die Datei zum erneuten Herunterladen */
export async function directDebitFile(id: string): Promise<{ xml: string; filename: string } | null> {
  const [row] = await db
    .select({ xml: schema.sepaDirectDebits.xml, messageId: schema.sepaDirectDebits.messageId })
    .from(schema.sepaDirectDebits)
    .where(eq(schema.sepaDirectDebits.id, id));
  return row ? { xml: row.xml, filename: `${row.messageId}.xml` } : null;
}
