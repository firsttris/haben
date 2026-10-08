import { UserError } from "./errors.ts";
import {
  computeInvoiceTotals,
  formatInvoiceNumber,
  invoiceLineInputSchema,
  invoiceDueDate,
  invoicePosting,
  legacyCorrectionPosting,
  lineNet,
  TAX_TREATMENT_KEYS,
  type TaxTreatment,
  type UnitLabel,
} from "@haben/core";
import {
  buildEInvoice,
  texts,
  validateForFormat,
  type Buyer,
  type InvoiceDocument,
  type InvoiceFormat,
  type Seller,
} from "@haben/einvoice";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { loadCompany, sellerIssues, type Company } from "./company.ts";
import type { Contact } from "./contacts.ts";
import { loadLogo } from "./logo.ts";
import { invoicePayments, stornoOpen } from "./bank.ts";
import { withActor } from "./db/actor.ts";
import { db, schema, type Db, type Tx } from "./db/index.ts";

export type Invoice = typeof schema.invoices.$inferSelect;
export type InvoiceLine = typeof schema.invoiceLines.$inferSelect;

export class InvoiceError extends UserError {}

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
    taxTreatment: z.enum(TAX_TREATMENT_KEYS).default("regulaer"),
    exemptionReason: z.string().trim().max(300).default(""),
    /** Sprache des PDFs für den Kunden */
    language: z.enum(["de", "en"]).default("de"),
    /** Abschlags- oder Schlussrechnung; null = normale Rechnung */
    variant: z.enum(["abschlag", "schluss"]).nullable().default(null),
    /** Schlussrechnung: abzuziehende Abschlagsrechnungen */
    deducts: z.array(z.uuid()).max(50).default([]),
    lines: z.array(invoiceLineInputSchema).max(200),
  })
  .refine((d) => !d.serviceFrom || !d.serviceTo || d.serviceFrom <= d.serviceTo, {
    message: "Leistungszeitraum endet vor seinem Beginn",
    path: ["serviceTo"],
  });

export type DraftInput = z.input<typeof draftSchema>;
type LineInput = DraftInput["lines"][number] & { deductionOf?: string };

function lineRows(invoiceId: string, lines: LineInput[]) {
  return lines.map((line, index) => ({
    invoiceId,
    position: index + 1,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    taxRate: line.taxRate,
    net: lineNet(line.quantity, line.unitPrice),
    deductionOf: line.deductionOf ?? null,
  }));
}

/** Titel je Rechnung, auch für Buchungstext und E-Mail */
export function invoiceTitle(invoice: Pick<Invoice, "kind" | "variant">): string {
  if (invoice.kind === "rechnung" && invoice.variant) return { abschlag: "Abschlagsrechnung", schluss: "Schlussrechnung" }[invoice.variant];
  return { rechnung: "Rechnung", storno: "Stornorechnung", korrektur: "Rechnungskorrektur" }[invoice.kind];
}

/** Festgeschriebene Rechnungen, die eine Stornorechnung aufhebt */
const cancelledIds = sql`select corrects_id from invoices where kind = 'storno' and status = 'final' and corrects_id is not null`;

/**
 * Schlussrechnungen, die eine Abschlagsrechnung schon abziehen (festgeschrieben, nicht storniert),
 * je Abschlagsrechnung die Nummer der Schlussrechnung
 */
async function deductedElsewhere(abschlagIds: string[], exceptInvoiceId: string | null, q: Db | Tx = db): Promise<Map<string, string>> {
  if (abschlagIds.length === 0) return new Map();
  const rows = await q
    .select({ abschlag: schema.invoiceLines.deductionOf, number: schema.invoices.number })
    .from(schema.invoiceLines)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLines.invoiceId))
    .where(
      and(
        inArray(schema.invoiceLines.deductionOf, abschlagIds),
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
  const lines = open.length
    ? await q.select().from(schema.invoiceLines).where(inArray(schema.invoiceLines.invoiceId, open.map((r) => r.id)))
    : [];
  return open.map((r) => ({
    id: r.id,
    contactId: r.contactId,
    number: r.number!,
    issueDate: r.issueDate,
    taxTreatment: r.taxTreatment,
    net: r.net,
    tax: r.tax,
    gross: r.gross,
    /** Netto und Steuer je Steuersatz, wie sie abgezogen werden */
    rates: computeInvoiceTotals(
      lines.filter((l) => l.invoiceId === r.id).map((l) => ({ ...l, taxRate: l.taxRate as 1900 | 700 | 0 })),
    ).taxes.map((t) => ({ rate: t.rate, base: t.base, tax: t.tax })),
  }));
}

export type OpenAbschlag = Awaited<ReturnType<typeof openAbschlaege>>[number];

/** Abzugspositionen der Schlussrechnung: je Abschlagsrechnung und Steuersatz eine negative Position */
function deductionLinesFor(abschlaege: OpenAbschlag[], language: "de" | "en", taxTreatment: TaxTreatment): LineInput[] {
  const t = texts(language);
  return abschlaege.flatMap((a) =>
    a.rates
      .filter((r) => r.base !== 0)
      .map((r) => ({
        description: t.deduction(a.number, t.date(a.issueDate), t.money(r.base), taxTreatment === "regulaer" ? t.money(r.tax) : null),
        quantity: 1000,
        unit: "Psch." as UnitLabel,
        unitPrice: -r.base,
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
    .where(and(eq(schema.invoiceLines.deductionOf, invoiceId), sql`${schema.invoices.id} not in (${cancelledIds})`));
  return { deducts, deductedIn };
}

/** Prüft die gewählten Abschlagsrechnungen; leere Liste = in Ordnung */
async function deductionProblems(invoiceId: string | null, input: Pick<DraftInput, "contactId" | "deducts" | "taxTreatment">, q: Db | Tx = db) {
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
    else if (abschlag.taxTreatment !== (input.taxTreatment ?? "regulaer")) problems.push(`Abschlagsrechnung ${abschlag.number} hat eine andere Umsatzsteuer-Behandlung`);
    else chosen.push(abschlag);
  }
  return { problems, chosen };
}

/** Positionen einer Rechnung samt Abzügen bei der Schlussrechnung */
async function allLines(invoiceId: string | null, input: DraftInput): Promise<LineInput[]> {
  if (input.variant !== "schluss") return input.lines;
  const { problems, chosen } = await deductionProblems(invoiceId, input);
  if (problems.length > 0) throw new InvoiceError(`${problems.join(", ")}.`);
  return [...input.lines, ...deductionLinesFor(chosen, input.language ?? "de", input.taxTreatment ?? "regulaer")];
}

function draftValues(input: DraftInput, bundesland: Company["bundesland"], lines: LineInput[]) {
  const totals = computeInvoiceTotals(lines);
  return {
    contactId: input.contactId,
    issueDate: input.issueDate,
    serviceFrom: input.serviceFrom,
    serviceTo: input.serviceTo,
    paymentTermDays: input.paymentTermDays,
    dueDate: invoiceDueDate(input.issueDate, input.paymentTermDays, bundesland),
    format: input.format,
    note: input.note,
    taxTreatment: input.taxTreatment ?? "regulaer",
    exemptionReason: input.taxTreatment && input.taxTreatment !== "regulaer" ? (input.exemptionReason ?? "").trim() : "",
    language: input.language ?? "de",
    variant: input.variant ?? null,
    net: totals.net,
    tax: totals.tax,
    gross: totals.gross,
    updatedAt: new Date(),
  };
}

export async function createDraft(
  actor: string,
  input: DraftInput,
  extra: Partial<Pick<Invoice, "kind" | "correctsId" | "recurringId" | "recurringDate">> = {},
) {
  const { bundesland } = await loadCompany();
  const lines = await allLines(null, input);
  return withActor(actor, async (tx) => {
    const [invoice] = await tx
      .insert(schema.invoices)
      .values({ ...draftValues(input, bundesland, lines), ...extra })
      .returning();
    if (lines.length > 0) await tx.insert(schema.invoiceLines).values(lineRows(invoice!.id, lines));
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
  const { bundesland } = await loadCompany();
  const lines = await allLines(id, input);
  return withActor(actor, async (tx) => {
    const draft = await lockDraft(tx, id);
    if (input.variant && draft.kind !== "rechnung") throw new InvoiceError("Storno und Korrektur sind keine Abschlags- oder Schlussrechnung.");
    await tx.delete(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, id));
    if (lines.length > 0) await tx.insert(schema.invoiceLines).values(lineRows(id, lines));
    const [updated] = await tx.update(schema.invoices).set(draftValues(input, bundesland, lines)).where(eq(schema.invoices.id, id)).returning();
    return updated!;
  });
}

export async function deleteDraft(actor: string, id: string) {
  await withActor(actor, async (tx) => {
    await lockDraft(tx, id);
    // Aus einem Angebot entstanden: das Angebot lässt sich danach wieder abrechnen
    await tx.update(schema.quotes).set({ invoiceId: null, updatedAt: new Date() }).where(eq(schema.quotes.invoiceId, id));
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
    taxTreatment: (company.kleinunternehmer ? "kleinunternehmer" : "regulaer") as TaxTreatment,
    exemptionReason: "",
    language: "de" as const,
    variant: null,
    deducts: [] as string[],
    lines: [
      { description: "", quantity: 1000, unit: "Std." as UnitLabel, unitPrice: 0, taxRate: (company.kleinunternehmer ? 0 : 1900) as 1900 | 0 },
    ],
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

/** Rechnungsliste mit abgeleitetem Status; bezahlt über die Zuordnungen im Bankabgleich. Mit `id` nur diese Rechnung. */
export async function listInvoices(today: string, id?: string) {
  const rows = await db
    .select({
      id: schema.invoices.id,
      kind: schema.invoices.kind,
      variant: schema.invoices.variant,
      status: schema.invoices.status,
      number: schema.invoices.number,
      issueDate: schema.invoices.issueDate,
      dueDate: schema.invoices.dueDate,
      gross: schema.invoices.gross,
      net: schema.invoices.net,
      correctsId: schema.invoices.correctsId,
      contactName: schema.contacts.name,
      buyerName: sql<string | null>`${schema.invoices.buyer} ->> 'name'`,
      cancelled: sql<boolean>`${schema.invoices.id} in (${cancelledIds})`,
    })
    .from(schema.invoices)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
    .where(id ? eq(schema.invoices.id, id) : undefined)
    .orderBy(sql`${schema.invoices.number} desc nulls first`, desc(schema.invoices.createdAt));

  const paid = await invoicePayments([
    ...rows.filter((r) => r.status === "final").map((r) => r.id),
    ...rows.filter((r) => r.kind === "storno" && r.correctsId).map((r) => r.correctsId!),
  ]);
  return rows.map(({ cancelled, ...row }) => {
    const paidAmount = paid.get(row.id) ?? 0;
    // Bei einem Storno bleibt offen, was auf die Rechnung gezahlt und noch nicht erstattet wurde
    const open =
      row.status !== "final" || cancelled
        ? 0
        : row.kind === "storno"
          ? stornoOpen(paid.get(row.correctsId!) ?? 0, paidAmount)
          : row.gross - paidAmount;
    let status: InvoiceListStatus;
    if (row.status === "draft") status = "entwurf";
    else if (row.kind === "storno") status = "storno";
    else if (cancelled) status = "storniert";
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
  deducted: { number: string; issueDate: string }[] = [],
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
    ...(invoice.taxTreatment !== "regulaer" ? { taxTreatment: invoice.taxTreatment } : {}),
    ...(invoice.exemptionReason ? { exemptionReason: invoice.exemptionReason } : {}),
    language: invoice.language,
    ...(invoice.kind === "rechnung" && invoice.variant ? { variant: invoice.variant } : {}),
    ...(deducted.length > 0 ? { deducted } : {}),
  };
}

/** Abschlagsrechnungen, die eine Schlussrechnung abzieht, in Reihenfolge der Positionen */
const deductionIds = (lines: InvoiceLine[]) => [...new Set(lines.map((l) => l.deductionOf).filter((id): id is string => Boolean(id)))];

/** Nummer und Datum der Abschlagsrechnungen, die eine Schlussrechnung abzieht, in Reihenfolge der Positionen */
async function deductedRefs(lines: InvoiceLine[]) {
  const ids = deductionIds(lines);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: schema.invoices.id, number: schema.invoices.number, issueDate: schema.invoices.issueDate })
    .from(schema.invoices)
    .where(inArray(schema.invoices.id, ids));
  return ids.map((id) => rows.find((r) => r.id === id)!).map((r) => ({ number: r.number ?? "", issueDate: r.issueDate }));
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Prüft, ob ein Entwurf festgeschrieben werden kann; leere Liste = bereit. */
export async function finalizeIssues(id: string): Promise<string[]> {
  const data = await getInvoice(id);
  if (!data) return ["Rechnung nicht gefunden"];
  const { invoice, lines, contact } = data;
  const company = await loadCompany();
  const issues = sellerIssues(company).map((issue) => `Firmendaten: ${issue}`);
  if (company.kleinunternehmer && invoice.taxTreatment !== "kleinunternehmer") {
    issues.push("Als Kleinunternehmer stellst du Rechnungen ohne Umsatzsteuer (§ 19 UStG)");
  }
  if (!company.kleinunternehmer && invoice.taxTreatment === "kleinunternehmer") {
    issues.push("Kleinunternehmer ist in den Einstellungen nicht eingeschaltet");
  }
  if (!contact) issues.push("Kunde fehlt");
  if (lines.length === 0) issues.push("Keine Positionen");
  if (lines.some((line) => line.net === 0)) issues.push("Position ohne Betrag");
  if (invoice.correctsId) {
    const [original] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoice.correctsId));
    const problem = original ? await originalProblem(original) : "Die korrigierte Rechnung fehlt";
    if (problem) issues.push(problem);
  }
  if (invoice.variant === "schluss") {
    const deducts = deductionIds(lines);
    if (deducts.length === 0) issues.push("Keine Abschlagsrechnung abgezogen");
    issues.push(...(await deductionProblems(id, { contactId: invoice.contactId, deducts, taxTreatment: invoice.taxTreatment })).problems);
    if (invoice.gross < 0) issues.push("Die Abschläge übersteigen die Gesamtleistung");
  } else if (invoice.kind === "rechnung" && invoice.gross <= 0) issues.push("Gesamtbetrag muss positiv sein");
  if (invoice.kind === "korrektur" && invoice.gross >= 0) issues.push("Eine Rechnungskorrektur muss den Betrag mindern");
  if (contact && issues.length === 0) {
    const preview = documentFor(
      invoice,
      lines,
      sellerFrom(company),
      buyerFrom(contact),
      "VORSCHAU",
      data.corrects?.number ? { number: data.corrects.number, issueDate: data.corrects.issueDate } : null,
      await deductedRefs(lines),
    );
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

    // Original und abgezogene Abschläge sperren und erneut prüfen: Ein paralleles Storno, eine Korrektur
    // oder eine andere Schlussrechnung kann seit finalizeIssues festgeschrieben worden sein.
    const deducts = deductionIds(lines);
    const referenced = [...(invoice.correctsId ? [invoice.correctsId] : []), ...deducts];
    if (referenced.length > 0) {
      await tx.select({ id: schema.invoices.id }).from(schema.invoices).where(inArray(schema.invoices.id, referenced)).orderBy(asc(schema.invoices.id)).for("update");
    }
    let corrects: Invoice | undefined;
    if (invoice.correctsId) {
      [corrects] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoice.correctsId));
      const problem = corrects ? await originalProblem(corrects, tx) : "Die korrigierte Rechnung fehlt";
      if (problem) throw new InvoiceError(`${problem}.`);
    }
    if (deducts.length > 0) {
      const { problems } = await deductionProblems(id, { contactId: invoice.contactId, deducts, taxTreatment: invoice.taxTreatment }, tx);
      if (problems.length > 0) throw new InvoiceError(`${problems.join(", ")}.`);
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
    const doc = documentFor(invoice, lines, seller, buyer, number, corrects ? { number: corrects.number!, issueDate: corrects.issueDate } : null, await deductedRefs(lines));
    const logo = await loadLogo();
    const rendered = await buildEInvoice(logo ? { ...doc, logo } : doc);
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

    const label = invoiceTitle(invoice);
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
        : invoicePosting(totals, company.kontenrahmen, company.versteuerung, invoice.taxTreatment)
      ).map((line) => ({ entryId: entry!.id, ...line })),
    );
    await tx.update(schema.journalEntries).set({ lockedAt: now }).where(eq(schema.journalEntries.id, entry!.id));

    return finalized!;
  });
}

/** Was gegen Storno oder Korrektur einer Rechnung spricht; null = in Ordnung */
async function originalProblem(original: Invoice, q: Db | Tx = db): Promise<string | null> {
  if (original.status !== "final" || original.kind !== "rechnung") return "Nur festgeschriebene Rechnungen können storniert oder korrigiert werden";
  const [storno] = await q
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.correctsId, original.id), eq(schema.invoices.kind, "storno"), eq(schema.invoices.status, "final")))
    .limit(1);
  if (storno) return `Die Rechnung ${original.number} ist bereits storniert`;
  const schluss = (await deductedElsewhere([original.id], null, q)).get(original.id);
  if (schluss) return `Die Abschlagsrechnung ist in Schlussrechnung ${schluss} abgezogen. Storniere zuerst die Schlussrechnung`;
  return null;
}

async function finalOriginal(id: string) {
  const data = await getInvoice(id);
  if (!data) throw new InvoiceError("Rechnung nicht gefunden.");
  const problem = await originalProblem(data.invoice);
  if (problem) throw new InvoiceError(`${problem}.`);
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
      taxTreatment: invoice.taxTreatment,
      exemptionReason: invoice.exemptionReason,
      language: invoice.language,
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
      taxTreatment: invoice.taxTreatment,
      exemptionReason: invoice.exemptionReason,
      language: invoice.language,
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

