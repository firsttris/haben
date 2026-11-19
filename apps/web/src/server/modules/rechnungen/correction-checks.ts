import { cancellationProblem } from "@haben/core";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { deductedElsewhere } from "./advance-deductions.ts";
import type { Invoice } from "./invoices.ts";

/* Was gegen Storno oder Korrektur einer Rechnung spricht; geprüft beim Anlegen und beim Festschreiben */

/** Was gegen Storno oder Korrektur einer Rechnung spricht; null = in Ordnung */
export async function originalProblem(original: Invoice, q: Db | Tx = db, of?: Invoice): Promise<string | null> {
  if (original.lexofficeVoucherId) {
    const [source] = await q
      .select({ source: schema.lexofficeVouchers.source })
      .from(schema.lexofficeVouchers)
      .where(eq(schema.lexofficeVouchers.id, original.lexofficeVoucherId));
    if (source?.source === "import")
      return "Diese Rechnung wurde mit fremden Originalbuchungen übernommen. Eine Korrektur muss zuerst mit diesen abgestimmt werden.";
  }
  const [storno] = await q
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.correctsId, original.id), eq(schema.invoices.kind, "storno"), eq(schema.invoices.status, "final")))
    .limit(1);
  const deductedIn = (await deductedElsewhere([original.id], null, q)).get(original.id) ?? null;
  // Das Storno einer Korrektur entsteht nur zusammen mit dem Storno ihrer Rechnung (cancelInvoice)
  const kinds = of?.kind === "storno" ? (["rechnung", "korrektur"] as const) : (["rechnung"] as const);
  return cancellationProblem(original, { cancelled: Boolean(storno), deductedIn }, kinds);
}

/** Mehrere Korrekturen zusammen mindern eine Rechnung höchstens bis auf 0, netto (die Steuer rundet jeder Beleg für sich) */
export async function reductionProblem(invoice: Invoice, original: Invoice, q: Db | Tx = db): Promise<string | null> {
  if (invoice.kind !== "korrektur") return null;
  const [corrections] = await q
    .select({ net: sql<number>`coalesce(sum(${schema.invoices.net}), 0)::int` })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.correctsId, original.id),
        eq(schema.invoices.kind, "korrektur"),
        eq(schema.invoices.status, "final"),
        ne(schema.invoices.id, invoice.id),
      ),
    );
  return original.net + corrections!.net + invoice.net < 0 ? "Die Korrekturen mindern die Rechnung unter 0" : null;
}
