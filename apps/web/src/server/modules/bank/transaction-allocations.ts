import { darlehenText, kategorieText, steuerzahlungText } from "@haben/core";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { ustvaLabels } from "../umsatzsteuer/index.ts";

export async function transactionAllocations(id: string) {
  const allocationRows = await db
    .select({
      id: schema.allocations.id,
      kind: schema.allocations.kind,
      amount: schema.allocations.amount,
      reversesId: schema.allocations.reversesId,
      splitId: schema.allocations.splitId,
      createdAt: schema.allocations.createdAt,
      invoiceId: schema.allocations.invoiceId,
      invoiceNumber: schema.invoices.number,
      documentId: schema.allocations.documentId,
      documentSupplier: schema.documents.supplierName,
      documentNumber: schema.documents.invoiceNumber,
      vatReturnId: schema.allocations.vatReturnId,
      taxType: schema.allocations.taxType,
      taxYear: schema.allocations.taxYear,
      taxItem: schema.allocations.taxItem,
      loanName: schema.loans.name,
      loanPart: schema.allocations.loanPart,
      category: schema.allocations.category,
      taxRate: schema.allocations.taxRate,
    })
    .from(schema.allocations)
    .leftJoin(schema.invoices, eq(schema.invoices.id, schema.allocations.invoiceId))
    .leftJoin(schema.documents, eq(schema.documents.id, schema.allocations.documentId))
    .leftJoin(schema.loans, eq(schema.loans.id, schema.allocations.loanId))
    .where(eq(schema.allocations.transactionId, id))
    // Teile einer Aufteilung haben denselben Zeitstempel (eine Transaktion): Erlös vor Gebühr, damit die Reihenfolge feststeht
    .orderBy(asc(schema.allocations.createdAt), desc(schema.allocations.amount), asc(schema.allocations.id));
  const reversed = new Set(allocationRows.filter((a) => a.reversesId).map((a) => a.reversesId));
  const vatLabels = await ustvaLabels(allocationRows.flatMap((a) => (a.vatReturnId ? [a.vatReturnId] : [])));
  return allocationRows
    .filter((a) => !a.reversesId)
    .map((a) => ({
      ...a,
      reversed: reversed.has(a.id),
      vatReturnLabel: a.vatReturnId ? (vatLabels.get(a.vatReturnId) ?? null) : null,
      steuerLabel: a.taxType && a.taxYear !== null && a.taxItem ? steuerzahlungText({ art: a.taxType, jahr: a.taxYear, posten: a.taxItem }, a.amount) : null,
      darlehenLabel: a.loanName && a.loanPart ? darlehenText(a.loanName, a.loanPart) : null,
      kategorieLabel: a.category && a.taxRate !== null ? kategorieText({ kategorie: a.category, steuersatz: a.taxRate }) : null,
    }));
}
