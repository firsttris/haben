import { documentOpen, invoiceOpen, skontoZahlfristen, type OpenItem } from "@haben/core";
import { and, eq, inArray } from "drizzle-orm";
import { type Db, db, schema, type Tx } from "../../db/index.ts";
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

/**
 * Offene Korrekturen an ihrer Rechnung (openCorrections): Der Abgleich bietet für „Rechnung minus Korrektur“ dann die
 * Aufteilung an statt Skonto oder Forderungsausfall (#1398)
 */
function attachOpenCorrections(items: OpenItem[], invoices: { id: string; kind: string; correctsId: string | null }[]): void {
  // Eine Korrektur korrigiert immer eine Rechnung, nie eine andere Korrektur (correction-checks.ts)
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const inv of invoices) {
    const original = inv.kind === "korrektur" && inv.correctsId ? byId.get(inv.correctsId) : undefined;
    const correction = byId.get(inv.id);
    if (!original || !correction) continue;
    original.openCorrections = [...(original.openCorrections ?? []), { id: correction.id, number: correction.number, open: correction.open }];
  }
}

/**
 * Rechnungen, deren Steuer zusammen mit ihren Korrekturen auf genau einem Steuersatz liegt. Nur dort verteilt sich ein
 * Skonto nach der Korrektur richtig: Das Ausbuchen verteilt nach dem Mix der Rechnung, nach einer Korrektur auf nur
 * einen von zwei Sätzen wäre es der Mix aus Rechnung und Korrektur (§ 17 Abs. 1 UStG, #1398).
 */
export async function mitEinemSteuersatz(gruppen: ReadonlyMap<string, readonly string[]>, q: Db | Tx = db): Promise<Set<string>> {
  const ids = [...gruppen].flatMap(([rechnung, korrekturen]) => [rechnung, ...korrekturen]);
  if (ids.length === 0) return new Set();
  const rows = await q
    .select({ invoiceId: schema.invoiceTaxes.invoiceId, rate: schema.invoiceTaxes.rate })
    .from(schema.invoiceTaxes)
    .where(inArray(schema.invoiceTaxes.invoiceId, ids));
  const saetze = (id: string) => rows.filter((r) => r.invoiceId === id).map((r) => r.rate);
  return new Set(
    [...gruppen].filter(([rechnung, korrekturen]) => new Set([rechnung, ...korrekturen].flatMap(saetze)).size === 1).map(([rechnung]) => rechnung),
  );
}

/**
 * Skonto nach den offenen Korrekturen (skontoNachKorrektur): Zieht der Kunde die Korrekturen ab und dann Skonto, ist das
 * Skonto vom geminderten Betrag gerechnet, nicht vom Betrag der Rechnung (#1398). Nur wo das Skonto noch gilt (skonto)
 * und alles auf einem Steuersatz liegt (mitEinemSteuersatz).
 */
async function attachSkontoNachKorrektur(
  items: OpenItem[],
  invoices: { id: string; skonto: Parameters<typeof skontoZahlfristen>[0]; issueDate: string; gross: number }[],
  bundesland: Parameters<typeof skontoZahlfristen>[3],
): Promise<void> {
  const byId = new Map(invoices.map((inv) => [inv.id, inv]));
  const kandidaten = items.filter((item) => item.skonto && item.openCorrections);
  const einSatz = await mitEinemSteuersatz(new Map(kandidaten.map((item) => [item.id, item.openCorrections!.map((k) => k.id)])));
  for (const item of kandidaten) {
    const inv = byId.get(item.id);
    if (!inv || !item.openCorrections || !einSatz.has(item.id)) continue;
    const gemindert = inv.gross + item.openCorrections.reduce((sum, k) => sum + k.open, 0);
    const fristen = gemindert > 0 ? skontoZahlfristen(inv.skonto, inv.issueDate, gemindert, bundesland) : [];
    if (fristen.length > 0) item.skontoNachKorrektur = fristen;
  }
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
  attachOpenCorrections(items, invoices);
  await attachSkontoNachKorrektur(items, invoices, bundesland);
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
