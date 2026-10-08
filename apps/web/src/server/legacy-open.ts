import { UserError } from "./errors.ts";
import {
  addDays,
  computeInvoiceTotals,
  openingDocumentPosting,
  openingInvoicePosting,
  type ExpenseCategory,
} from "@haben/core";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { loadCompany, type Company } from "./company.ts";
import { withActor } from "./db/actor.ts";
import { db, schema, type Tx } from "./db/index.ts";
import type { LegacyCategoryRow } from "./db/schema.ts";
import { buyerFrom, sellerFrom } from "./invoices.ts";
import { loadFile } from "./storage.ts";
import { today } from "./today.ts";

export class TakeoverError extends UserError {}

type LegacyVoucher = typeof schema.lexofficeVouchers.$inferSelect;

/** Belegarten, die als offener Posten nach Haben wandern können */
const SALES = new Set(["invoice"]);
const PURCHASES = new Set(["purchaseinvoice"]);
const OPEN_STATUS = new Set(["open", "overdue", "sepadebit"]);

export interface OpenLegacyItem {
  id: string;
  type: string;
  direction: "einnahme" | "ausgabe";
  number: string;
  date: string;
  dueDate: string | null;
  contactName: string;
  gross: number;
  open: number;
  /** Übernommen als Rechnung bzw. Beleg in Haben */
  takenOver: { kind: "invoice" | "document"; id: string } | null;
  /** Warum sich der Posten nicht übernehmen lässt */
  blocker: string | null;
}

/** Offener Betrag laut Lexoffice; ohne Zahlungsdaten zählt der Status. */
function openAmount(voucher: Pick<LegacyVoucher, "payment" | "status" | "gross">): number {
  if (voucher.payment) return Math.abs(voucher.payment.openAmount);
  return OPEN_STATUS.has(voucher.status) ? Math.abs(voucher.gross) : 0;
}

function blockerFor(voucher: LegacyVoucher, hasPdf: boolean): string | null {
  if (voucher.currency !== "EUR") return "Fremdwährung";
  if (openAmount(voucher) !== Math.abs(voucher.gross)) return "teilweise bezahlt – Restbetrag erst in Lexoffice ausgleichen oder ohne Rechnung buchen";
  if (voucher.taxes.some((t) => ![1900, 700, 0].includes(t.rate))) return "Steuersatz, den Haben nicht kennt";
  if (voucher.gross <= 0) return "Betrag nicht positiv";
  if (!hasPdf) return "keine Datei aus Lexoffice";
  return null;
}

/** Offene Rechnungen und Eingangsbelege aus Lexoffice, die in Haben noch bezahlt werden */
export async function openLegacyItems(): Promise<OpenLegacyItem[]> {
  const vouchers = await db
    .select()
    .from(schema.lexofficeVouchers)
    .where(inArray(schema.lexofficeVouchers.type, [...SALES, ...PURCHASES]))
    .orderBy(schema.lexofficeVouchers.date, schema.lexofficeVouchers.number);
  const candidates = vouchers.filter((v) => openAmount(v) > 0);
  if (candidates.length === 0) return [];
  const ids = candidates.map((v) => v.id);
  const [files, invoices, documents] = await Promise.all([
    db
      .selectDistinct({ voucherId: schema.lexofficeVoucherFiles.voucherId })
      .from(schema.lexofficeVoucherFiles)
      .where(and(inArray(schema.lexofficeVoucherFiles.voucherId, ids), inArray(schema.lexofficeVoucherFiles.role, ["pdf", "anhang"]))),
    db
      .select({ id: schema.invoices.id, voucherId: schema.invoices.lexofficeVoucherId })
      .from(schema.invoices)
      .where(isNotNull(schema.invoices.lexofficeVoucherId)),
    db
      .select({ id: schema.documents.id, voucherId: schema.documents.lexofficeVoucherId })
      .from(schema.documents)
      .where(isNotNull(schema.documents.lexofficeVoucherId)),
  ]);
  const withFile = new Set(files.map((f) => f.voucherId));
  const invoiceBy = new Map(invoices.map((i) => [i.voucherId, i.id]));
  const documentBy = new Map(documents.map((d) => [d.voucherId, d.id]));
  return candidates.map((v) => {
    const invoiceId = invoiceBy.get(v.id);
    const documentId = documentBy.get(v.id);
    return {
      id: v.id,
      type: v.type,
      direction: v.direction,
      number: v.number,
      date: v.date,
      dueDate: v.dueDate,
      contactName: v.contactName,
      gross: v.gross,
      open: openAmount(v),
      takenOver: invoiceId ? { kind: "invoice", id: invoiceId } : documentId ? { kind: "document", id: documentId } : null,
      blocker: blockerFor(v, withFile.has(v.id)),
    };
  });
}

/** Lexoffice-Kategorie grob auf die Ausgabenkategorie von Haben abbilden; sie zählt nur für die EÜR-Aufteilung */
const CATEGORY_HINTS: [RegExp, ExpenseCategory][] = [
  [/software|lizenz/i, "software"],
  [/hosting|server|cloud|edv|it-/i, "edv"],
  [/hardware|gwg|geringwertig/i, "hardware"],
  [/telefon|mobilfunk/i, "telefon"],
  [/internet/i, "internet"],
  [/büro|buero/i, "buero"],
  [/literatur|zeitschrift|bücher/i, "literatur"],
  [/fortbildung|seminar|weiterbildung/i, "fortbildung"],
  [/übernachtung|hotel/i, "uebernachtung"],
  [/reise|fahrt|bahn|taxi/i, "fahrtkosten"],
  [/porto|versand/i, "porto"],
  [/werbung|marketing/i, "werbung"],
  [/buchführung|buchhaltung|steuerberat/i, "buchfuehrung"],
  [/beratung|rechts/i, "beratung"],
  [/fremdleistung|subunternehm/i, "fremdleistung"],
  [/kontoführung|gebühr|nebenkosten des geldverkehrs/i, "geldverkehr"],
  [/versicherung/i, "versicherung"],
  [/beitr/i, "beitraege"],
];

function categoryFor(categories: LegacyCategoryRow[]): ExpenseCategory {
  const names = categories.map((c) => c.name).join(" ");
  return CATEGORY_HINTS.find(([pattern]) => pattern.test(names))?.[1] ?? "sonstiges";
}

async function journal(
  tx: Tx,
  entry: { date: string; description: string; sourceType: "invoice" | "document"; sourceId: string; kontenrahmen: Company["kontenrahmen"] },
  lines: ReturnType<typeof openingDocumentPosting>,
) {
  const [row] = await tx.insert(schema.journalEntries).values(entry).returning();
  await tx.insert(schema.journalLines).values(lines.map((line) => ({ entryId: row!.id, ...line })));
  await tx.update(schema.journalEntries).set({ lockedAt: new Date() }).where(eq(schema.journalEntries.id, row!.id));
}

/**
 * Übernimmt einen offenen Posten aus Lexoffice, damit der Zahlungseingang bzw. die Zahlung im Bankabgleich
 * zugeordnet werden kann: Rechnungen mit Original-PDF und Lexoffice-Nummer, Belege gebucht und gesperrt.
 * Gebucht wird gegen den Saldenvortrag, nicht als Erlös oder Aufwand; die stehen schon in den alten Büchern.
 */
export async function takeOverLegacyItem(actor: string, voucherId: string): Promise<{ kind: "invoice" | "document"; id: string }> {
  const items = await openLegacyItems();
  const item = items.find((i) => i.id === voucherId);
  if (!item) throw new TakeoverError("Dieser Beleg ist in Lexoffice nicht offen.");
  if (item.takenOver) throw new TakeoverError("Schon übernommen.");
  if (item.blocker) throw new TakeoverError(`Nicht übernehmbar: ${item.blocker}.`);
  return takeOver(actor, item);
}

async function takeOver(actor: string, item: OpenLegacyItem): Promise<{ kind: "invoice" | "document"; id: string }> {
  const [voucher] = await db.select().from(schema.lexofficeVouchers).where(eq(schema.lexofficeVouchers.id, item.id));
  const files = await db.select().from(schema.lexofficeVoucherFiles).where(eq(schema.lexofficeVoucherFiles.voucherId, item.id));
  return item.direction === "einnahme" ? takeOverInvoice(actor, voucher!, files) : takeOverDocument(actor, voucher!, files);
}

async function takeOverInvoice(
  actor: string,
  voucher: LegacyVoucher,
  files: (typeof schema.lexofficeVoucherFiles.$inferSelect)[],
): Promise<{ kind: "invoice"; id: string }> {
  const company = await loadCompany();
  const pdfFile = files.find((f) => f.role === "pdf") ?? files.find((f) => f.mimeType === "application/pdf");
  if (!pdfFile) throw new TakeoverError("Zu dieser Rechnung fehlt das PDF.");
  const xmlFile = files.find((f) => f.role === "xml");
  const pdf = await loadFile(pdfFile.sha256);
  const xml = xmlFile ? (await loadFile(xmlFile.sha256)).toString("utf8") : null;

  // Eine Position je Steuersatz; die Summen müssen exakt zu Lexoffice passen, sonst stimmt die Steuer nicht
  const lines = voucher.taxes
    .filter((t) => t.net !== 0)
    .map((t, i) => ({
      position: i + 1,
      description: `Rechnung ${voucher.number} aus Lexoffice${voucher.taxes.length > 1 ? ` (${t.rate / 100} %)` : ""}`,
      quantity: 1000,
      unit: "Psch.",
      unitPrice: t.net,
      taxRate: t.rate,
      net: t.net,
    }));
  const totals = computeInvoiceTotals(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate as 1900 | 700 | 0 })));
  if (totals.gross !== voucher.gross || totals.tax !== voucher.tax) {
    throw new TakeoverError(
      `Die Steuer lässt sich nicht centgenau nachbilden (Lexoffice ${voucher.tax / 100} €, Haben ${totals.tax / 100} €).`,
    );
  }

  return withActor(actor, async (tx) => {
    if (voucher.number) {
      const [clash] = await tx.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.number, voucher.number));
      if (clash) throw new TakeoverError(`Die Rechnungsnummer ${voucher.number} gibt es in Haben schon.`);
    }
    let [contact] = voucher.contactId ? await tx.select().from(schema.contacts).where(eq(schema.contacts.id, voucher.contactId)) : [];
    if (!contact) {
      const raw = voucher.raw as { address?: { name?: string; street?: string; zip?: string; city?: string; countryCode?: string } };
      [contact] = await tx
        .insert(schema.contacts)
        .values({
          name: raw.address?.name || voucher.contactName || "Unbekannt",
          strasse: raw.address?.street ?? "",
          plz: raw.address?.zip ?? "",
          ort: raw.address?.city ?? "",
          land: raw.address?.countryCode ?? "DE",
        })
        .returning();
    }
    const dueDate = voucher.dueDate ?? addDays(voucher.date, 14);
    const term = Math.max(0, Math.min(365, Math.round((Date.parse(dueDate) - Date.parse(voucher.date)) / 86_400_000)));
    const [invoice] = await tx
      .insert(schema.invoices)
      .values({
        kind: "rechnung",
        contactId: contact!.id,
        issueDate: voucher.date,
        serviceFrom: voucher.serviceFrom,
        serviceTo: voucher.serviceTo,
        paymentTermDays: term,
        dueDate,
        note: "Aus Lexoffice übernommen; das PDF ist das Original.",
        net: totals.net,
        tax: totals.tax,
        gross: totals.gross,
      })
      .returning({ id: schema.invoices.id });
    const id = invoice!.id;
    await tx.insert(schema.invoiceLines).values(lines.map((l) => ({ ...l, invoiceId: id })));
    const now = new Date();
    await tx
      .update(schema.invoices)
      .set({
        status: "final",
        number: voucher.number || `LX-${voucher.lexofficeId.slice(0, 8)}`,
        contactVersion: contact!.version,
        seller: sellerFrom(company),
        buyer: buyerFrom(contact!),
        pdf: Buffer.from(pdf),
        pdfSha256: pdfFile.sha256,
        xml,
        xmlSha256: xml ? createHash("sha256").update(xml).digest("hex") : null,
        lexofficeVoucherId: voucher.id,
        lockedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.invoices.id, id));
    await journal(
      tx,
      {
        date: today(),
        description: `Offene Rechnung ${voucher.number} aus Lexoffice · ${contact!.name}`,
        sourceType: "invoice",
        sourceId: id,
        kontenrahmen: company.kontenrahmen,
      },
      openingInvoicePosting(totals, company.kontenrahmen, company.versteuerung),
    );
    return { kind: "invoice" as const, id };
  });
}

async function takeOverDocument(
  actor: string,
  voucher: LegacyVoucher,
  files: (typeof schema.lexofficeVoucherFiles.$inferSelect)[],
): Promise<{ kind: "document"; id: string }> {
  const file = files.find((f) => f.mimeType === "application/pdf") ?? files[0];
  if (!file) throw new TakeoverError("Zu diesem Beleg fehlt die Datei.");
  const company = await loadCompany();
  return withActor(actor, async (tx) => {
    const [existing] = await tx.select({ id: schema.documents.id }).from(schema.documents).where(eq(schema.documents.sha256, file.sha256));
    if (existing) throw new TakeoverError("Die Datei liegt in Haben schon als Beleg; bitte dort bezahlen.");
    const now = new Date();
    const [doc] = await tx
      .insert(schema.documents)
      .values({
        sha256: file.sha256,
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.size,
        extractedBy: "manuell",
        supplierName: voucher.contactName,
        invoiceNumber: voucher.number,
        documentDate: voucher.date,
        dueDate: voucher.dueDate,
        category: categoryFor(voucher.categories),
        payment: "bank",
        note: "Aus Lexoffice übernommen; die Vorsteuer ist dort schon angemeldet.",
        net: voucher.net,
        tax: voucher.tax,
        gross: voucher.gross,
        lexofficeVoucherId: voucher.id,
      })
      .returning({ id: schema.documents.id });
    const id = doc!.id;
    await tx.insert(schema.documentAmounts).values(voucher.taxes.map((t) => ({ documentId: id, taxRate: t.rate, net: t.net, tax: t.tax })));
    await journal(
      tx,
      {
        date: today(),
        description: `Offener Beleg ${voucher.number || file.filename} aus Lexoffice · ${voucher.contactName}`,
        sourceType: "document",
        sourceId: id,
        kontenrahmen: company.kontenrahmen,
      },
      openingDocumentPosting(voucher.gross, company.kontenrahmen),
    );
    await tx.update(schema.documents).set({ status: "gebucht", lockedAt: now, updatedAt: now }).where(eq(schema.documents.id, id));
    return { kind: "document" as const, id };
  });
}

/** Alle übernehmbaren offenen Posten auf einmal; Fehler einzelner Posten kommen zurück */
export async function takeOverAll(actor: string) {
  const items = (await openLegacyItems()).filter((i) => !i.takenOver && !i.blocker);
  const results: { number: string; error?: string }[] = [];
  for (const item of items) {
    try {
      await takeOver(actor, item);
      results.push({ number: item.number });
    } catch (error) {
      if (!(error instanceof TakeoverError)) throw error;
      results.push({ number: item.number, error: error.message });
    }
  }
  return results;
}
