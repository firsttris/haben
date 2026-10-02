import {
  addDays,
  computeInvoiceTotals,
  formatInvoiceNumber,
  invoiceLineInputSchema,
  invoicePosting,
  legacyCorrectionPosting,
  lineNet,
  type UnitLabel,
} from "@haben/core";
import {
  buildEInvoice,
  validateForFormat,
  type Buyer,
  type InvoiceDocument,
  type InvoiceFormat,
  type Seller,
} from "@haben/einvoice";
import { asc, desc, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { loadCompany, sellerIssues, type Company } from "./company.ts";
import type { Contact } from "./contacts.ts";
import { invoicePayments, stornoOpen } from "./bank.ts";
import { withActor } from "./db/actor.ts";
import { db, schema, type Tx } from "./db/index.ts";

export type Invoice = typeof schema.invoices.$inferSelect;
export type InvoiceLine = typeof schema.invoiceLines.$inferSelect;

export class InvoiceError extends Error {}

const isoDate = z.iso.date();

export const draftSchema = z
  .object({
    contactId: z.uuid().nullable(),
    issueDate: isoDate,
    serviceFrom: isoDate.nullable(),
    serviceTo: isoDate.nullable(),
    paymentTermDays: z.number().int().min(0).max(120),
    format: z.enum(["zugferd", "xrechnung-cii", "xrechnung-ubl"]),
    note: z.string().max(2000),
    lines: z.array(invoiceLineInputSchema).max(200),
  })
  .refine((d) => !d.serviceFrom || !d.serviceTo || d.serviceFrom <= d.serviceTo, {
    message: "Leistungszeitraum endet vor seinem Beginn",
    path: ["serviceTo"],
  });

export type DraftInput = z.infer<typeof draftSchema>;

function lineRows(invoiceId: string, lines: DraftInput["lines"]) {
  return lines.map((line, index) => ({
    invoiceId,
    position: index + 1,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    taxRate: line.taxRate,
    net: lineNet(line.quantity, line.unitPrice),
  }));
}

function draftValues(input: DraftInput) {
  const totals = computeInvoiceTotals(input.lines);
  return {
    contactId: input.contactId,
    issueDate: input.issueDate,
    serviceFrom: input.serviceFrom,
    serviceTo: input.serviceTo,
    paymentTermDays: input.paymentTermDays,
    dueDate: addDays(input.issueDate, input.paymentTermDays),
    format: input.format,
    note: input.note,
    net: totals.net,
    tax: totals.tax,
    gross: totals.gross,
    updatedAt: new Date(),
  };
}

export async function createDraft(actor: string, input: DraftInput, extra: Partial<Pick<Invoice, "kind" | "correctsId">> = {}) {
  return withActor(actor, async (tx) => {
    const [invoice] = await tx
      .insert(schema.invoices)
      .values({ ...draftValues(input), ...extra })
      .returning();
    if (input.lines.length > 0) await tx.insert(schema.invoiceLines).values(lineRows(invoice!.id, input.lines));
    return invoice!;
  });
}

async function lockDraft(tx: Tx, id: string): Promise<Invoice> {
  const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, id)).for("update");
  if (!invoice) throw new InvoiceError("Rechnung nicht gefunden.");
  if (invoice.status !== "draft") throw new InvoiceError("Die Rechnung ist festgeschrieben und kann nicht mehr geändert werden.");
  return invoice;
}

export async function updateDraft(actor: string, id: string, input: DraftInput) {
  return withActor(actor, async (tx) => {
    await lockDraft(tx, id);
    await tx.delete(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, id));
    if (input.lines.length > 0) await tx.insert(schema.invoiceLines).values(lineRows(id, input.lines));
    const [updated] = await tx.update(schema.invoices).set(draftValues(input)).where(eq(schema.invoices.id, id)).returning();
    return updated!;
  });
}

export async function deleteDraft(actor: string, id: string) {
  await withActor(actor, async (tx) => {
    await lockDraft(tx, id);
    await tx.delete(schema.invoices).where(eq(schema.invoices.id, id));
  });
}

/** Neue Rechnung mit den Vorgaben aus den Firmendaten */
export async function newDraftDefaults(today: string) {
  const company = await loadCompany();
  return {
    contactId: null,
    issueDate: today,
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: company.paymentTermDays,
    format: company.defaultFormat,
    note: "",
    lines: [{ description: "", quantity: 1000, unit: "Std." as UnitLabel, unitPrice: 0, taxRate: 1900 as const }],
  } satisfies DraftInput;
}

export async function getInvoice(id: string) {
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id));
  if (!invoice) return null;
  const lines = await db
    .select()
    .from(schema.invoiceLines)
    .where(eq(schema.invoiceLines.invoiceId, id))
    .orderBy(asc(schema.invoiceLines.position));
  const [contact] = invoice.contactId
    ? await db.select().from(schema.contacts).where(eq(schema.contacts.id, invoice.contactId))
    : [];
  const [corrects] = invoice.correctsId
    ? await db
        .select({ id: schema.invoices.id, number: schema.invoices.number, issueDate: schema.invoices.issueDate })
        .from(schema.invoices)
        .where(eq(schema.invoices.id, invoice.correctsId))
    : [];
  const correctedBy = await db
    .select({ id: schema.invoices.id, number: schema.invoices.number, kind: schema.invoices.kind, status: schema.invoices.status })
    .from(schema.invoices)
    .where(eq(schema.invoices.correctsId, id))
    .orderBy(asc(schema.invoices.createdAt));
  return { invoice, lines, contact: contact ?? null, corrects: corrects ?? null, correctedBy };
}

export type InvoiceListStatus =
  | "entwurf"
  | "offen"
  | "teilbezahlt"
  | "bezahlt"
  | "ueberfaellig"
  | "storniert"
  | "storno"
  | "korrektur";

/** Rechnungsliste mit abgeleitetem Status; bezahlt über die Zuordnungen im Bankabgleich. */
export async function listInvoices(today: string) {
  const rows = await db
    .select({
      id: schema.invoices.id,
      kind: schema.invoices.kind,
      status: schema.invoices.status,
      number: schema.invoices.number,
      issueDate: schema.invoices.issueDate,
      dueDate: schema.invoices.dueDate,
      gross: schema.invoices.gross,
      net: schema.invoices.net,
      correctsId: schema.invoices.correctsId,
      contactName: schema.contacts.name,
      buyerName: sql<string | null>`${schema.invoices.buyer} ->> 'name'`,
    })
    .from(schema.invoices)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
    .orderBy(sql`${schema.invoices.number} desc nulls first`, desc(schema.invoices.createdAt));

  const paid = await invoicePayments(rows.filter((r) => r.status === "final").map((r) => r.id));
  const cancelled = new Set(
    rows.filter((r) => r.kind === "storno" && r.status === "final" && r.correctsId).map((r) => r.correctsId!),
  );
  return rows.map((row) => {
    const paidAmount = paid.get(row.id) ?? 0;
    // Bei einem Storno bleibt offen, was auf die Rechnung gezahlt und noch nicht erstattet wurde
    const open =
      row.status !== "final" || cancelled.has(row.id)
        ? 0
        : row.kind === "storno"
          ? stornoOpen(paid.get(row.correctsId!) ?? 0, paidAmount)
          : row.gross - paidAmount;
    let status: InvoiceListStatus;
    if (row.status === "draft") status = "entwurf";
    else if (row.kind === "storno") status = "storno";
    else if (cancelled.has(row.id)) status = "storniert";
    else if (open === 0) status = row.kind === "korrektur" ? "korrektur" : "bezahlt";
    else if (row.kind === "korrektur") status = "korrektur";
    else if (row.dueDate < today) status = "ueberfaellig";
    else if (paidAmount !== 0) status = "teilbezahlt";
    else status = "offen";
    return { ...row, customer: row.buyerName ?? row.contactName ?? "–", listStatus: status, paid: paidAmount, open };
  });
}

export function sellerFrom(company: Company): Seller {
  return {
    name: company.name,
    strasse: company.strasse,
    plz: company.plz,
    ort: company.ort,
    land: "DE",
    email: company.email,
    ...(company.telefon ? { telefon: company.telefon } : {}),
    ...(company.steuernummer ? { steuernummer: company.steuernummer } : {}),
    ...(company.ustId ? { ustId: company.ustId } : {}),
    ...(company.iban ? { iban: company.iban } : {}),
    ...(company.bic ? { bic: company.bic } : {}),
    ...(company.bank ? { bank: company.bank } : {}),
  };
}

export function buyerFrom(contact: Contact): Buyer {
  return {
    name: contact.name,
    strasse: contact.strasse,
    plz: contact.plz,
    ort: contact.ort,
    land: contact.land,
    ...(contact.email ? { email: contact.email } : {}),
    ...(contact.ustId ? { ustId: contact.ustId } : {}),
    ...(contact.leitwegId ? { leitwegId: contact.leitwegId } : {}),
    ...(contact.kundennummer ? { kundennummer: contact.kundennummer } : {}),
  };
}

function documentFor(
  invoice: Invoice,
  lines: InvoiceLine[],
  seller: Seller,
  buyer: Buyer,
  number: string,
  corrects: { number: string; issueDate: string } | null,
): InvoiceDocument {
  return {
    kind: invoice.kind,
    format: invoice.format as InvoiceFormat,
    number,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    paymentTermDays: invoice.paymentTermDays,
    ...(invoice.serviceFrom ? { serviceFrom: invoice.serviceFrom } : {}),
    ...(invoice.serviceTo ? { serviceTo: invoice.serviceTo } : {}),
    currency: "EUR",
    seller,
    buyer,
    lines: lines.map((line) => ({
      position: line.position,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit as UnitLabel,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate,
      net: line.net,
    })),
    totals: computeInvoiceTotals(lines.map((line) => ({ ...line, taxRate: line.taxRate as 1900 | 700 | 0 }))),
    ...(corrects ? { corrects } : {}),
    ...(invoice.note ? { note: invoice.note } : {}),
  };
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Prüft, ob ein Entwurf festgeschrieben werden kann; leere Liste = bereit. */
export async function finalizeIssues(id: string): Promise<string[]> {
  const data = await getInvoice(id);
  if (!data) return ["Rechnung nicht gefunden"];
  const { invoice, lines, contact } = data;
  const issues = sellerIssues(await loadCompany()).map((issue) => `Firmendaten: ${issue}`);
  if (!contact) issues.push("Kunde fehlt");
  if (lines.length === 0) issues.push("Keine Positionen");
  if (lines.some((line) => line.net === 0)) issues.push("Position ohne Betrag");
  if (invoice.kind === "rechnung" && invoice.gross <= 0) issues.push("Gesamtbetrag muss positiv sein");
  if (invoice.kind === "korrektur" && invoice.gross >= 0) issues.push("Eine Rechnungskorrektur muss den Betrag mindern");
  if (contact && issues.length === 0) {
    const preview = documentFor(invoice, lines, sellerFrom(await loadCompany()), buyerFrom(contact), "VORSCHAU", data.corrects?.number ? { number: data.corrects.number, issueDate: data.corrects.issueDate } : null);
    issues.push(...validateForFormat(preview));
  }
  return issues;
}

/**
 * Festschreiben: Nummer ziehen, PDF und XML erzeugen, sperren und buchen – alles in einer
 * Transaktion. Schlägt etwas fehl, bleibt der Entwurf ohne Nummer und es entsteht keine Lücke.
 */
export async function finalizeInvoice(actor: string, id: string): Promise<Invoice> {
  const issues = await finalizeIssues(id);
  if (issues.length > 0) throw new InvoiceError(`Noch nicht bereit: ${issues.join(", ")}.`);

  return withActor(actor, async (tx) => {
    const invoice = await lockDraft(tx, id);
    const company = await loadCompany();
    const lines = await tx
      .select()
      .from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.invoiceId, id))
      .orderBy(asc(schema.invoiceLines.position));
    const [contact] = await tx.select().from(schema.contacts).where(eq(schema.contacts.id, invoice.contactId!));

    let corrects: Invoice | undefined;
    if (invoice.correctsId) {
      [corrects] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoice.correctsId));
      if (!corrects?.number) throw new InvoiceError("Die korrigierte Rechnung ist nicht festgeschrieben.");
    }

    const year = Number(invoice.issueDate.slice(0, 4));
    const [counter] = await tx
      .insert(schema.invoiceNumberCounters)
      .values({ year, last: 1 })
      .onConflictDoUpdate({ target: schema.invoiceNumberCounters.year, set: { last: sql`${schema.invoiceNumberCounters.last} + 1` } })
      .returning();
    const number = formatInvoiceNumber(year, counter!.last);

    // Storno und Korrektur gehen an die Anschrift der ursprünglichen Rechnung.
    const seller = sellerFrom(company);
    const buyer = corrects?.buyer ?? buyerFrom(contact!);
    const doc = documentFor(invoice, lines, seller, buyer, number, corrects ? { number: corrects.number!, issueDate: corrects.issueDate } : null);
    const rendered = await buildEInvoice(doc);
    const totals = doc.totals;
    const now = new Date();

    const [finalized] = await tx
      .update(schema.invoices)
      .set({
        status: "final",
        number,
        numberYear: year,
        numberCounter: counter!.last,
        contactVersion: contact!.version,
        seller,
        buyer,
        net: totals.net,
        tax: totals.tax,
        gross: totals.gross,
        pdf: Buffer.from(rendered.pdf),
        pdfSha256: sha256(rendered.pdf),
        xml: rendered.xml,
        xmlSha256: sha256(rendered.xml),
        lockedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.invoices.id, id))
      .returning();

    const label = { rechnung: "Rechnung", storno: "Stornorechnung", korrektur: "Rechnungskorrektur" }[invoice.kind];
    const [entry] = await tx
      .insert(schema.journalEntries)
      .values({
        date: invoice.issueDate,
        description: `${label} ${number} · ${buyer.name}`,
        sourceType: "invoice",
        sourceId: id,
        kontenrahmen: company.kontenrahmen,
      })
      .returning();
    await tx.insert(schema.journalLines).values(
      // Korrektur einer aus Lexoffice übernommenen Rechnung: deren Erlöse stehen in den alten Büchern
      (corrects?.lexofficeVoucherId
        ? legacyCorrectionPosting(totals, company.kontenrahmen, company.versteuerung)
        : invoicePosting(totals, company.kontenrahmen, company.versteuerung)
      ).map((line) => ({ entryId: entry!.id, ...line })),
    );
    await tx.update(schema.journalEntries).set({ lockedAt: now }).where(eq(schema.journalEntries.id, entry!.id));

    return finalized!;
  });
}

async function finalOriginal(id: string) {
  const data = await getInvoice(id);
  if (!data) throw new InvoiceError("Rechnung nicht gefunden.");
  if (data.invoice.status !== "final" || data.invoice.kind !== "rechnung") {
    throw new InvoiceError("Nur festgeschriebene Rechnungen können storniert oder korrigiert werden.");
  }
  if (data.correctedBy.some((c) => c.kind === "storno" && c.status === "final")) {
    throw new InvoiceError("Die Rechnung ist bereits storniert.");
  }
  return data;
}

function negatedLines(lines: InvoiceLine[]): DraftInput["lines"] {
  return lines.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    unit: line.unit as UnitLabel,
    unitPrice: -line.unitPrice,
    taxRate: line.taxRate as 1900 | 700 | 0,
  }));
}

/** Stornorechnung mit allen Positionen negativ, sofort festgeschrieben. */
export async function cancelInvoice(actor: string, id: string, today: string): Promise<Invoice> {
  const { invoice, lines } = await finalOriginal(id);
  const draft = await createDraft(
    actor,
    {
      contactId: invoice.contactId,
      issueDate: today,
      serviceFrom: invoice.serviceFrom,
      serviceTo: invoice.serviceTo,
      paymentTermDays: 0,
      format: invoice.format,
      note: "",
      lines: negatedLines(lines),
    },
    { kind: "storno", correctsId: invoice.id },
  );
  try {
    return await finalizeInvoice(actor, draft.id);
  } catch (error) {
    await deleteDraft(actor, draft.id);
    throw error;
  }
}

/** Rechnungskorrektur als Entwurf: Positionen negativ übernommen, zum Anpassen. */
export async function createCorrection(actor: string, id: string, today: string): Promise<Invoice> {
  const { invoice, lines } = await finalOriginal(id);
  return createDraft(
    actor,
    {
      contactId: invoice.contactId,
      issueDate: today,
      serviceFrom: invoice.serviceFrom,
      serviceTo: invoice.serviceTo,
      paymentTermDays: 0,
      format: invoice.format,
      note: "",
      lines: negatedLines(lines),
    },
    { kind: "korrektur", correctsId: invoice.id },
  );
}

/** Nächste Rechnungsnummer des Jahres, z. B. um nach Lexoffice nahtlos weiterzuzählen. */
export async function numbering(year: number) {
  const [counter] = await db.select().from(schema.invoiceNumberCounters).where(eq(schema.invoiceNumberCounters.year, year));
  const last = counter?.last ?? 0;
  return { year, last, next: formatInvoiceNumber(year, last + 1) };
}

export async function setNextNumber(actor: string, year: number, next: number) {
  const { last } = await numbering(year);
  if (next <= last) throw new InvoiceError(`Die nächste Nummer muss größer als ${formatInvoiceNumber(year, last)} sein.`);
  await withActor(actor, (tx) =>
    tx
      .insert(schema.invoiceNumberCounters)
      .values({ year, last: next - 1 })
      .onConflictDoUpdate({ target: schema.invoiceNumberCounters.year, set: { last: next - 1 } }),
  );
}

/** Kennzahlen für die Übersicht */
export async function invoiceSummary(today: string) {
  const list = await listInvoices(today);
  const open = list.filter((i) => i.kind === "rechnung" && i.open !== 0);
  const openIds = new Set(open.map((i) => i.id));
  // Offene Korrekturen mindern die Forderung ihrer Rechnung
  const corrections = list.filter((i) => i.kind === "korrektur" && i.open !== 0 && i.correctsId && openIds.has(i.correctsId));
  const month = today.slice(0, 7);
  const previousMonth = (() => {
    const [y, m] = month.split("-").map(Number) as [number, number];
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();
  const finals = list.filter((i) => i.status === "final" && i.listStatus !== "storniert" && i.kind !== "storno");
  const revenue = (prefix: string) =>
    finals.filter((i) => i.issueDate.startsWith(prefix)).reduce((sum, i) => sum + i.net, 0);
  return {
    openTotal: [...open, ...corrections].reduce((sum, i) => sum + i.open, 0),
    openCount: open.length,
    overdueCount: open.filter((i) => i.listStatus === "ueberfaellig").length,
    revenueMonth: { key: month, net: revenue(month) },
    revenuePreviousMonth: { key: previousMonth, net: revenue(previousMonth) },
    recent: list.filter((i) => i.status === "final").slice(0, 5),
    drafts: list.filter((i) => i.status === "draft").length,
  };
}

