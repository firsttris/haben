import { EXPENSE_CATEGORIES, totalsFromTaxes, type EuerPayment, type ExpenseCategory } from "@haben/core";
import { and, eq, lte, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

export function uncertainImportMessage(count: number): string {
  const subject = count === 1 ? "einer übernommenen Rechnung" : `${count} übernommenen Rechnungen`;
  return `Bei ${subject} sind Zahlungsdaten noch ungeklärt. Die EÜR enthält nur nachgewiesene Zahlungen; offene Posten und Bezahlt-Status zeigen den übernommenen Quellstand.`;
}

/** Nur bestätigte Zahlungsdaten aus dem allgemeinen Import, nie bloße Bezahlt-Markierungen. */
export async function importedEuerPayments(year: number, q: Db | Tx = db): Promise<EuerPayment[]> {
  const rows = await q
    .select({ id: schema.externalImports.id, cashFlows: schema.externalImports.cashFlows })
    .from(schema.externalImports)
    .where(eq(schema.externalImports.kind, "journal"));
  const payments: EuerPayment[] = [];
  for (const row of rows)
    for (const [index, flow] of row.cashFlows.entries()) {
      if (flow.date < `${year}-01-01` || flow.date >= `${year + 1}-01-01`) continue;
      const group = `import:${row.id}:${index}`;
      const paid = flow.category === "einnahme" ? flow.amount : -flow.amount;
      const totals = totalsFromTaxes([{ rate: 0, base: paid, tax: 0 }]);
      if (flow.category === "einnahme") payments.push({ kind: "invoice", date: flow.date, paid, totals, treatment: "kleinunternehmer", group });
      else {
        if (!Object.hasOwn(EXPENSE_CATEGORIES, flow.category)) throw new Error("Ungültige importierte EÜR-Kategorie.");
        payments.push({ kind: "document", date: flow.date, paid, totals, category: flow.category as ExpenseCategory, vorsteuerAbzug: false, group });
      }
    }
  return payments;
}

/** Zahlungsjahr unbekannt: Ein Datum wird weder aus dem Rechnungsdatum noch aus der Übernahmezeit erfunden. */
export async function uncertainImportPayments(year: number, q: Db | Tx = db): Promise<number> {
  const [row] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.externalImports)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.externalImports.invoiceId))
    .where(and(eq(schema.externalImports.paymentUncertain, true), lte(schema.invoices.issueDate, `${year}-12-31`)));
  return row?.n ?? 0;
}
