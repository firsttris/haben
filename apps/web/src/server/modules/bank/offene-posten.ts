import { documentOpen, invoiceOpen, skontoZahlfristen, type OpenItem } from "@haben/core";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { documentNotCancelled } from "../../db/document-cancelled.ts";
import { invoicePayments, paidByTarget, paperCancellationIds } from "../rechnungen/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { today } from "../../today.ts";
import { documentPayees, ibanDecisions, payeeIbans } from "./document-payees.ts";
import { directDebitReferences } from "./lastschrift-abgleich.ts";

/* Offene Rechnungen und Belege für den Abgleich der Bankumsätze (transaction-detail.ts) */

/** Bestellnummern einer Rechnung für den Abgleich: externe Referenz, Bestellnummer des Kunden, eigene Auftragsnummer */
function orderReferencesOf(inv: { externalId: string | null; buyerOrderReference: string; sellerOrderReference: string }, externalId = inv.externalId) {
  const refs = [...new Set([externalId ?? "", inv.buyerOrderReference, inv.sellerOrderReference].map((r) => r.trim()).filter(Boolean))];
  return refs.length > 0 ? { orderReferences: refs } : {};
}

/** Festgeschriebene Rechnungen und Korrekturen, dazu die Stornos, mit Kontakt und Bestellnummern */
async function finalInvoiceRows() {
  const invoices = await db
    .select({
      id: schema.invoices.id,
      kind: schema.invoices.kind,
      correctsId: schema.invoices.correctsId,
      number: schema.invoices.number,
      issueDate: schema.invoices.issueDate,
      dueDate: schema.invoices.dueDate,
      gross: schema.invoices.gross,
      currency: schema.invoices.currency,
      skonto: schema.invoices.skonto,
      buyer: schema.invoices.buyer,
      contactIban: schema.contacts.iban,
      externalId: schema.invoices.externalId,
      buyerOrderReference: schema.invoices.buyerOrderReference,
      sellerOrderReference: schema.invoices.sellerOrderReference,
    })
    .from(schema.invoices)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
    .where(and(eq(schema.invoices.status, "final"), inArray(schema.invoices.kind, ["rechnung", "korrektur"])));
  const stornos = await db
    .select({
      id: schema.invoices.id,
      correctsId: schema.invoices.correctsId,
      number: schema.invoices.number,
      issueDate: schema.invoices.issueDate,
      buyer: schema.invoices.buyer,
      contactIban: schema.contacts.iban,
      externalId: schema.invoices.externalId,
      buyerOrderReference: schema.invoices.buyerOrderReference,
      sellerOrderReference: schema.invoices.sellerOrderReference,
    })
    .from(schema.invoices)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
    .where(and(eq(schema.invoices.kind, "storno"), eq(schema.invoices.status, "final")));
  return { invoices, stornos };
}

/** Gebuchte Belege mit Zahlung über die Bank, nicht storniert */
function bookedBankDocuments() {
  return (
    db
      .select({
        id: schema.documents.id,
        invoiceNumber: schema.documents.invoiceNumber,
        documentDate: schema.documents.documentDate,
        uploadedAt: schema.documents.uploadedAt,
        dueDate: schema.documents.dueDate,
        gross: schema.documents.gross,
        currency: schema.documents.currency,
        supplierName: schema.documents.supplierName,
      })
      .from(schema.documents)
      // Storniert: nichts mehr zu zahlen; stornieren lässt Haben nur ohne Zahlung (#237)
      .where(and(eq(schema.documents.status, "gebucht"), eq(schema.documents.payment, "bank"), documentNotCancelled()))
  );
}

/** Offene Rechnungen und Belege für den Abgleich */
export async function openItems(): Promise<OpenItem[]> {
  const { invoices, stornos } = await finalInvoiceRows();
  const cancelled = new Set(stornos.map((r) => r.correctsId));
  // Die eindeutige externe Referenz bleibt am Original. Für den Abgleich zählen Korrektur und Storno zur selben Bestellung.
  const externalIds = new Map(invoices.map((inv) => [inv.id, inv.externalId]));
  for (const inv of invoices) {
    if (inv.correctsId && !inv.externalId) externalIds.set(inv.id, externalIds.get(inv.correctsId) ?? null);
  }
  const invoicePaid = await invoicePayments([...invoices.map((i) => i.id), ...stornos.map((st) => st.id)]);
  const paperStornos = await paperCancellationIds(stornos.map((st) => st.id));
  // EndToEndIds der Lastschriften aus Haben (#445): ein Einzelumsatz aus einem CAMT-Auszug findet so seine Rechnung
  const directDebitRefs = await directDebitReferences(invoices.map((i) => i.id));

  const documents = await bookedBankDocuments();
  const documentPaid = await paidByTarget(
    "document_id",
    documents.map((d) => d.id),
  );
  // Konto des Lieferanten und Referenzen der SEPA-Überweisungen aus Haben: Die Abbuchung findet so ihren Beleg
  const ids = documents.map((d) => d.id);
  const [payees, decisions] = await Promise.all([documentPayees(ids), ibanDecisions(ids)]);
  // Feiertage für das Ende der Skontofrist (§ 193 BGB) wie beim Zahlungsziel: die im Bundesland der Firma
  const { bundesland } = await loadCompany();

  const items: OpenItem[] = [];
  for (const inv of invoices) {
    const paid = invoicePaid.get(inv.id) ?? 0;
    const open = invoiceOpen({ status: "final", kind: inv.kind, gross: inv.gross, paid, cancelled: cancelled.has(inv.id) });
    if (open === 0) continue;
    // Skonto nur auf den ganzen Betrag: nach einer Teilzahlung oder Ausbuchung erkennt der Abgleich es nicht mehr
    const skonto = inv.kind === "rechnung" && inv.currency === "EUR" && paid === 0 ? skontoZahlfristen(inv.skonto, inv.issueDate, inv.gross, bundesland) : [];
    items.push({
      type: "invoice",
      id: inv.id,
      number: inv.number!,
      date: inv.issueDate,
      dueDate: inv.dueDate,
      open,
      partyName: inv.buyer?.name ?? "",
      partyIbans: inv.contactIban ? [inv.contactIban] : [],
      ...(directDebitRefs.has(inv.id) ? { references: directDebitRefs.get(inv.id) } : {}),
      ...orderReferencesOf(inv, externalIds.get(inv.id)),
      currency: inv.currency,
      ...(skonto.length > 0 ? { skonto } : {}),
    });
  }
  // Storno einer schon bezahlten Rechnung: die Erstattung wird der Stornorechnung zugeordnet
  for (const storno of stornos) {
    if (paperStornos.has(storno.id)) continue;
    const open = invoiceOpen({
      status: "final",
      kind: "storno",
      gross: 0,
      paid: invoicePaid.get(storno.id) ?? 0,
      paidOnOriginal: invoicePaid.get(storno.correctsId!) ?? 0,
      cancelled: false,
    });
    if (open === 0) continue;
    items.push({
      type: "invoice",
      id: storno.id,
      number: storno.number!,
      date: storno.issueDate,
      dueDate: storno.issueDate,
      open,
      partyName: storno.buyer?.name ?? "",
      partyIbans: storno.contactIban ? [storno.contactIban] : [],
      // Storno erbt die Bestellnummer der Rechnung (#389): die Erstattung beim Dienstleister findet es darüber
      ...orderReferencesOf(storno, externalIds.get(storno.correctsId!)),
    });
  }
  for (const doc of documents) {
    const open = documentOpen(doc.gross, documentPaid.get(doc.id) ?? 0);
    if (open === 0) continue;
    items.push({
      type: "document",
      id: doc.id,
      number: doc.invoiceNumber,
      date: doc.documentDate ?? today(doc.uploadedAt),
      dueDate: doc.dueDate,
      open,
      partyName: doc.supplierName,
      partyIbans: payeeIbans(payees.get(doc.id), decisions.get(doc.id) ?? []),
      references: payees.get(doc.id)?.references ?? [],
      currency: doc.currency,
    });
  }
  return items;
}
