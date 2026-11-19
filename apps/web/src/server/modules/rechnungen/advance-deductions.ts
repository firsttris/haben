import { outgoingTaxDetailConflict, type PriceMode, type TaxTreatment, type UnitLabel } from "@haben/core";
import { texts } from "@haben/einvoice";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { cancelledIds } from "./cancelled-invoices.ts";
import type { DraftInput, LineInput } from "./draft-schema.ts";
import { invoiceTotalsById } from "./invoice-taxes.ts";
import type { InvoiceLine } from "./invoices.ts";

/* Abschlagsrechnungen, die eine Schlussrechnung abzieht: offene Abschläge, Abzugspositionen und ihre Prüfung */

/**
 * Schlussrechnungen, die eine Abschlagsrechnung schon abziehen (festgeschrieben, nicht storniert),
 * je Abschlagsrechnung die Nummer der Schlussrechnung
 */
export async function deductedElsewhere(abschlagIds: string[], exceptInvoiceId: string | null, q: Db | Tx = db): Promise<Map<string, string>> {
  if (abschlagIds.length === 0) return new Map();
  const rows = await q
    .select({ abschlag: schema.invoiceLines.deductionOf, number: schema.invoices.number })
    .from(schema.invoiceLines)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLines.invoiceId))
    .where(
      and(
        inArray(schema.invoiceLines.deductionOf, abschlagIds),
        // Nur Schlussrechnungen ziehen ab; Storno und Korrektur tragen den Abzug nur für die Grundlage des Gesamtrabatts mit
        eq(schema.invoices.kind, "rechnung"),
        eq(schema.invoices.status, "final"),
        sql`${schema.invoices.id} not in (${cancelledIds})`,
        exceptInvoiceId ? ne(schema.invoices.id, exceptInvoiceId) : undefined,
      ),
    );
  return new Map(rows.map((r) => [r.abschlag!, r.number ?? ""]));
}

/** Abschlagsrechnungen eines Kunden, die eine Schlussrechnung noch abziehen kann */
export async function openAbschlaege(exceptInvoiceId: string | null = null, q: Db | Tx = db) {
  const rows = await q
    .select()
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.kind, "rechnung"),
        eq(schema.invoices.variant, "abschlag"),
        eq(schema.invoices.status, "final"),
        sql`${schema.invoices.id} not in (${cancelledIds})`,
      ),
    )
    .orderBy(asc(schema.invoices.issueDate), asc(schema.invoices.number));
  const taken = await deductedElsewhere(
    rows.map((r) => r.id),
    exceptInvoiceId,
    q,
  );
  const open = rows.filter((r) => !taken.has(r.id));
  const totals = await invoiceTotalsById(
    open.map((r) => r.id),
    q,
  );
  return open.map((r) => ({
    id: r.id,
    contactId: r.contactId,
    quoteId: r.quoteId,
    number: r.number!,
    issueDate: r.issueDate,
    advanceType: r.advanceType,
    propertyRetention: r.propertyRetention,
    taxTreatment: r.taxTreatment,
    exemptionReason: r.exemptionReason,
    taxDetails: r.taxDetails,
    priceMode: r.priceMode,
    net: r.net,
    tax: r.tax,
    gross: r.gross,
    /** Netto und Steuer je Steuersatz, wie sie abgezogen werden */
    rates: totals.get(r.id)!.taxes,
  }));
}

export type OpenAbschlag = Awaited<ReturnType<typeof openAbschlaege>>[number];

/**
 * Abzugspositionen der Schlussrechnung: je Abschlagsrechnung und Steuersatz eine negative Position,
 * bei Bruttopreisen über Netto und Umsatzsteuer der Abschlagsrechnung
 */
export function deductionLinesFor(abschlaege: OpenAbschlag[], language: "de" | "en", taxTreatment: TaxTreatment, priceMode: PriceMode): LineInput[] {
  const t = texts(language);
  return abschlaege.flatMap((a) =>
    a.rates
      .filter((r) => r.base !== 0)
      .map((r) => ({
        description: t.deduction(a.number, t.date(a.issueDate), t.money(r.base), taxTreatment === "regulaer" ? t.money(r.tax) : null),
        quantity: 1000,
        unit: "Psch." as UnitLabel,
        unitPrice: -(priceMode === "brutto" ? r.base + r.tax : r.base),
        taxRate: r.rate as 1900 | 700 | 0,
        deductionOf: a.id,
      })),
  );
}

/** Für die Detailseite: welche Abschläge eine Schlussrechnung abzieht und wo eine Abschlagsrechnung abgezogen ist */
export async function abschlagLinks(invoiceId: string) {
  const deducts = await db
    .selectDistinct({ id: schema.invoices.id, number: schema.invoices.number })
    .from(schema.invoiceLines)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLines.deductionOf))
    .where(eq(schema.invoiceLines.invoiceId, invoiceId));
  const deductedIn = await db
    .selectDistinct({ id: schema.invoices.id, number: schema.invoices.number, status: schema.invoices.status })
    .from(schema.invoiceLines)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLines.invoiceId))
    .where(and(eq(schema.invoiceLines.deductionOf, invoiceId), eq(schema.invoices.kind, "rechnung"), sql`${schema.invoices.id} not in (${cancelledIds})`));
  return { deducts, deductedIn };
}

/** Prüft die gewählten Abschlagsrechnungen; leere Liste = in Ordnung */
export async function deductionProblems(
  invoiceId: string | null,
  input: Pick<DraftInput, "contactId" | "deducts" | "taxTreatment" | "taxDetails">,
  q: Db | Tx = db,
) {
  const ids = [...new Set(input.deducts ?? [])];
  const open = await openAbschlaege(invoiceId, q);
  const problems: string[] = [];
  const chosen: OpenAbschlag[] = [];
  for (const id of ids) {
    const abschlag = open.find((a) => a.id === id);
    if (!abschlag) {
      const [row] = await q.select({ number: schema.invoices.number }).from(schema.invoices).where(eq(schema.invoices.id, id));
      const taken = (await deductedElsewhere([id], invoiceId, q)).get(id);
      problems.push(
        taken
          ? `Abschlagsrechnung ${row?.number ?? ""} ist schon in Schlussrechnung ${taken} abgezogen`
          : `Abschlagsrechnung ${row?.number ?? id} ist nicht festgeschrieben oder storniert`,
      );
    } else if (abschlag.contactId !== input.contactId) problems.push(`Abschlagsrechnung ${abschlag.number} gehört zu einem anderen Kunden`);
    else if (abschlag.taxTreatment !== (input.taxTreatment ?? "regulaer"))
      problems.push(`Abschlagsrechnung ${abschlag.number} hat eine andere Umsatzsteuer-Behandlung`);
    else {
      // Ungeklärte Angaben dürfen keinen bekannten Widerspruch zwischen anderen Abschlägen verdecken.
      // Produktgrenze: https://github.com/firsttris/haben/issues/433#issuecomment-6853419682
      const conflict = [input.taxDetails, ...chosen.map((a) => a.taxDetails)]
        .map((details) => outgoingTaxDetailConflict(input.taxTreatment ?? "regulaer", abschlag.taxDetails, details))
        .find((problem) => problem !== null);
      if (conflict === "exemption") problems.push(`Abschlagsrechnung ${abschlag.number} hat eine andere Befreiungsvorschrift`);
      else if (conflict === "foreignPlace") problems.push(`Abschlagsrechnung ${abschlag.number} hat einen anderen tatsächlichen Leistungsort`);
      else chosen.push(abschlag);
    }
  }
  return { problems, chosen };
}

/** Abschlagsrechnungen, die eine Schlussrechnung abzieht, in Reihenfolge der Positionen */
export const deductionIds = (lines: InvoiceLine[]) => [...new Set(lines.map((l) => l.deductionOf).filter((id): id is string => Boolean(id)))];

/** Nummer und Datum der Abschlagsrechnungen, die eine Schlussrechnung abzieht, in Reihenfolge der Positionen */
export async function deductedRefs(lines: InvoiceLine[], q: Db | Tx = db) {
  const ids = deductionIds(lines);
  if (ids.length === 0) return [];
  const rows = await q
    .select({ id: schema.invoices.id, number: schema.invoices.number, issueDate: schema.invoices.issueDate })
    .from(schema.invoices)
    .where(inArray(schema.invoices.id, ids));
  return ids.map((id) => rows.find((r) => r.id === id)!).map((r) => ({ number: r.number ?? "", issueDate: r.issueDate }));
}
