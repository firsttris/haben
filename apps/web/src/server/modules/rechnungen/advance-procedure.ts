import { isKapitalgesellschaft, type Rechtsform } from "@haben/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";

type Invoice = typeof schema.invoices.$inferSelect;
type Deduction = Pick<typeof schema.invoiceLines.$inferSelect, "deductionOf">;

export interface AdvanceProcedure {
  advanceAccounting: "deferred" | null;
  replacesInvoiceId: string | null;
}

export class AdvanceProcedureError extends UserError {}

const previousProcedure: AdvanceProcedure = { advanceAccounting: null, replacesInvoiceId: null };
const deferredProcedure: AdvanceProcedure = { advanceAccounting: "deferred", replacesInvoiceId: null };
const deductionIds = (lines: readonly Deduction[]) => [...new Set(lines.flatMap((line) => (line.deductionOf ? [line.deductionOf] : [])))].sort();
const performanceDate = (invoice: Invoice) => invoice.serviceTo ?? invoice.serviceFrom ?? invoice.issueDate;

async function originalProcedure(invoice: Invoice, tx: Tx): Promise<AdvanceProcedure> {
  let original = invoice;
  const seen = new Set([invoice.id]);
  while (original.correctsId) {
    if (seen.has(original.correctsId)) throw new AdvanceProcedureError("Die Korrekturkette der Rechnung ist nicht eindeutig.");
    seen.add(original.correctsId);
    const [parent] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, original.correctsId));
    if (!parent) throw new AdvanceProcedureError("Die ursprüngliche Rechnung der Korrektur fehlt.");
    original = parent;
  }
  return { advanceAccounting: original.advanceAccounting, replacesInvoiceId: null };
}

/** Nur Überschneidungen laden; der vollständige Abzugssatz wird danach geprüft, nicht aus einer Teilauswahl geraten. */
async function previousFinals(ids: string[], tx: Tx): Promise<Invoice[]> {
  const referenced = await tx
    .selectDistinct({ id: schema.invoices.id })
    .from(schema.invoiceLines)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLines.invoiceId))
    .where(
      and(
        inArray(schema.invoiceLines.deductionOf, ids),
        eq(schema.invoices.kind, "rechnung"),
        eq(schema.invoices.variant, "schluss"),
        eq(schema.invoices.status, "final"),
        eq(schema.invoices.advanceAccounting, "deferred"),
      ),
    );
  if (!referenced.length) return [];
  // Der Aufrufer hält zuvor die Abzugsoriginale gesperrt. Vorgänger vor Nummernkreis und Audit-Kette sperren.
  return tx
    .select()
    .from(schema.invoices)
    .where(
      inArray(
        schema.invoices.id,
        referenced.map((r) => r.id),
      ),
    )
    .orderBy(asc(schema.invoices.id))
    .for("update");
}

async function sameDeductions(previous: Invoice[], ids: string[], tx: Tx): Promise<void> {
  const rows = await tx
    .select({ invoiceId: schema.invoiceLines.invoiceId, deductionOf: schema.invoiceLines.deductionOf })
    .from(schema.invoiceLines)
    .where(
      inArray(
        schema.invoiceLines.invoiceId,
        previous.map((p) => p.id),
      ),
    );
  for (const invoice of previous) {
    const before = deductionIds(rows.filter((r) => r.invoiceId === invoice.id));
    if (before.length !== ids.length || before.some((id, i) => id !== ids[i])) {
      throw new AdvanceProcedureError(
        "Die Abzüge stimmen nicht mit der bisherigen Schlussrechnung überein; eine geänderte Abschlagsmenge ist fachlich zu klären.",
      );
    }
  }
}

/** Ein zusammenhängender gespeicherter Pfad, kein jüngstes Datum und keine Vereinigung unabhängiger Schlussleistungen. */
function lastReplacement(previous: Invoice[]): Invoice {
  const invoices = new Map(previous.map((p) => [p.id, p]));
  const replaced = new Set(previous.flatMap((p) => (p.replacesInvoiceId ? [p.replacesInvoiceId] : [])));
  const leaves = previous.filter((p) => !replaced.has(p.id));
  const ambiguous = () =>
    new AdvanceProcedureError("Der bisherige Schlussrechnungsersatz ist nicht eindeutig; die bereits realisierte Leistung muss fachlich zugeordnet werden.");
  if (leaves.length !== 1) throw ambiguous();
  const seen = new Set<string>();
  let current: Invoice | undefined = leaves[0];
  while (current) {
    if (seen.has(current.id)) throw ambiguous();
    seen.add(current.id);
    if (!current.replacesInvoiceId) break;
    current = invoices.get(current.replacesInvoiceId);
    if (!current) throw ambiguous();
  }
  if (seen.size !== previous.length) throw ambiguous();
  return leaves[0]!;
}

async function assertCancelledWithoutCorrection(previous: Invoice[], deductions: string[], tx: Tx): Promise<void> {
  const ids = previous.map((p) => p.id);
  const cancellations = await tx
    .select({ correctsId: schema.invoices.correctsId })
    .from(schema.invoices)
    .where(and(inArray(schema.invoices.correctsId, ids), eq(schema.invoices.kind, "storno"), eq(schema.invoices.status, "final")));
  const cancelled = new Set(cancellations.map((c) => c.correctsId));
  if (ids.some((id) => !cancelled.has(id))) throw new AdvanceProcedureError("Die bisherige Schlussrechnung ist noch nicht storniert.");
  const [correction] = await tx
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(inArray(schema.invoices.correctsId, [...ids, ...deductions]), eq(schema.invoices.kind, "korrektur"), eq(schema.invoices.status, "final")))
    .limit(1);
  if (correction)
    throw new AdvanceProcedureError(
      "Die bestehende Korrektur ist vor einem Ersatz fachlich zu klären; ihr Änderungszeitpunkt wird nicht aus dem Ersatzbeleg abgeleitet.",
    );
}

async function sameAmounts(invoice: Invoice, previous: Invoice[], tx: Tx): Promise<void> {
  const rows = await tx
    .select()
    .from(schema.invoiceTaxes)
    .where(inArray(schema.invoiceTaxes.invoiceId, [invoice.id, ...previous.map((p) => p.id)]));
  const shares = (id: string) => rows.filter((r) => r.invoiceId === id).sort((a, b) => a.rate - b.rate);
  const current = shares(invoice.id);
  for (const before of previous) {
    const recorded = shares(before.id);
    if (
      recorded.length !== current.length ||
      recorded.some((r, i) => r.rate !== current[i]!.rate || r.base !== current[i]!.base || r.tax !== current[i]!.tax)
    ) {
      throw new AdvanceProcedureError(
        "Die Beträge je Steuersatz stimmen nicht mit der bisherigen Schlussrechnung überein; eine Entgeltänderung braucht eine eigene fachliche Zuordnung.",
      );
    }
  }
}

/**
 * Verfahrensentscheidung vor dem Festschreiben; Abzugsoriginale sind bereits durch den Aufrufer gesperrt.
 * Die Leistung bleibt bei bloßem Schluss-Storno erbracht. Ein Ersatz übernimmt sie nur mit eindeutigen Bezügen und
 * unveränderten Beträgen; Altbelege und ihre Korrekturketten behalten ihr Verfahren.
 * Quelle: https://github.com/firsttris/haben/issues/750#issuecomment-6837873675
 */
export async function advanceProcedure(invoice: Invoice, lines: readonly Deduction[], company: { rechtsform: Rechtsform }, tx: Tx): Promise<AdvanceProcedure> {
  if (invoice.status === "final") return { advanceAccounting: invoice.advanceAccounting, replacesInvoiceId: invoice.replacesInvoiceId };
  if (invoice.correctsId) return originalProcedure(invoice, tx);
  if (!isKapitalgesellschaft(company.rechtsform)) return previousProcedure;
  if (invoice.variant === "abschlag" && invoice.advanceType !== "teilleistung") return deferredProcedure;
  if (invoice.variant !== "schluss") return previousProcedure;
  const ids = deductionIds(lines);
  if (!ids.length) return previousProcedure;
  const [advance] = await tx
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(
      and(
        inArray(schema.invoices.id, ids),
        eq(schema.invoices.kind, "rechnung"),
        eq(schema.invoices.status, "final"),
        eq(schema.invoices.advanceType, "anzahlung"),
        eq(schema.invoices.advanceAccounting, "deferred"),
      ),
    )
    .limit(1);
  if (!advance) return previousProcedure;
  const previous = await previousFinals(ids, tx);
  if (!previous.length) return deferredProcedure;
  await sameDeductions(previous, ids, tx);
  const last = lastReplacement(previous);
  await assertCancelledWithoutCorrection(previous, ids, tx);
  if (
    previous.some(
      (p) =>
        p.contactId !== invoice.contactId ||
        p.taxTreatment !== invoice.taxTreatment ||
        p.currency !== invoice.currency ||
        performanceDate(p) !== performanceDate(invoice),
    )
  ) {
    throw new AdvanceProcedureError("Kunde, Steuerbehandlung, Währung und Leistungsdatum müssen mit der bisherigen Schlussrechnung übereinstimmen.");
  }
  await sameAmounts(invoice, previous, tx);
  return { advanceAccounting: "deferred", replacesInvoiceId: last.id };
}
