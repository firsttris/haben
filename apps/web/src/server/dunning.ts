import {
  addDays,
  DEFAULT_INTEREST_MARKUP,
  DUNNING_LEVELS,
  DUNNING_TEXTS,
  dunningAmounts,
  type DunningLevel,
} from "@haben/core";
import { buildDunningPdf } from "@haben/einvoice";
import { desc, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { loadCompany } from "./company.ts";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";
import { listInvoices } from "./invoices.ts";
import { loadLogo } from "./logo.ts";

export class DunningError extends Error {}

export type Dunning = Omit<typeof schema.dunnings.$inferSelect, "pdf">;

const dunningColumns = {
  id: schema.dunnings.id,
  invoiceId: schema.dunnings.invoiceId,
  level: schema.dunnings.level,
  date: schema.dunnings.date,
  dueDate: schema.dunnings.dueDate,
  open: schema.dunnings.open,
  fee: schema.dunnings.fee,
  flatFee: schema.dunnings.flatFee,
  interest: schema.dunnings.interest,
  interestRate: schema.dunnings.interestRate,
  interestDays: schema.dunnings.interestDays,
  total: schema.dunnings.total,
  intro: schema.dunnings.intro,
  closing: schema.dunnings.closing,
  pdfSha256: schema.dunnings.pdfSha256,
  createdAt: schema.dunnings.createdAt,
};

export async function dunningsFor(invoiceIds: string[]): Promise<Dunning[]> {
  if (invoiceIds.length === 0) return [];
  return db.select(dunningColumns).from(schema.dunnings).where(inArray(schema.dunnings.invoiceId, invoiceIds)).orderBy(desc(schema.dunnings.date), desc(schema.dunnings.createdAt));
}

const nextLevel = (last: Dunning | undefined): DunningLevel => (Math.min((last?.level ?? 0) + 1, 3) as DunningLevel);

/**
 * Überfällige Rechnungen mit ihrer letzten Mahnung. „Frist läuft“, solange die Frist der letzten
 * Mahnung noch nicht abgelaufen ist.
 */
export async function overdueInvoices(today: string) {
  const overdue = (await listInvoices(today)).filter((i) => i.listStatus === "ueberfaellig");
  const dunnings = await dunningsFor(overdue.map((i) => i.id));
  return overdue.map((invoice) => {
    const last = dunnings.find((d) => d.invoiceId === invoice.id);
    return {
      ...invoice,
      lastDunning: last ?? null,
      nextLevel: nextLevel(last),
      waiting: Boolean(last && last.dueDate >= today),
    };
  });
}

async function openInvoice(invoiceId: string, today: string) {
  const invoice = (await listInvoices(today)).find((i) => i.id === invoiceId);
  if (!invoice || invoice.status !== "final") throw new DunningError("Rechnung nicht gefunden.");
  if (invoice.kind !== "rechnung" || invoice.open <= 0) throw new DunningError("Für diese Rechnung ist nichts offen.");
  return invoice;
}

/** Vorschlag für eine neue Mahnung: nächste Stufe, Frist, Gebühr und Texte aus den Einstellungen */
export async function dunningDraft(invoiceId: string, today: string) {
  const invoice = await openInvoice(invoiceId, today);
  const { dunning } = await loadCompany();
  const [last] = await dunningsFor([invoiceId]);
  const level = nextLevel(last);
  return {
    invoice: { id: invoice.id, number: invoice.number!, issueDate: invoice.issueDate, dueDate: invoice.dueDate, customer: invoice.customer, open: invoice.open },
    level,
    date: today,
    dueDate: addDays(today, dunning.deadlineDays),
    fee: dunning.fees[String(level) as "1" | "2" | "3"] ?? 0,
    baseRate: dunning.baseRate,
    texts: DUNNING_TEXTS,
  };
}

export const dunningInputSchema = z.object({
  invoiceId: z.uuid(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  dueDate: z.iso.date(),
  fee: z.number().int().min(0).max(100_000),
  flatFee: z.boolean(),
  /** Verzugszinsen: Aufschlag auf den Basiszinssatz nach Kundenart, null = keine */
  interest: z.enum(["geschaeftskunde", "verbraucher"]).nullable(),
  intro: z.string().trim().min(1).max(2000),
  closing: z.string().trim().max(2000),
});

export type DunningInput = z.infer<typeof dunningInputSchema>;

/** Erstellt die Mahnung mit PDF; Beträge werden zum heutigen Stand berechnet */
export async function createDunning(actor: string, input: DunningInput, today: string): Promise<Dunning> {
  const listed = await openInvoice(input.invoiceId, today);
  if (listed.dueDate >= today) throw new DunningError("Die Rechnung ist noch nicht fällig.");
  if (input.dueDate <= today) throw new DunningError("Die neue Zahlungsfrist muss in der Zukunft liegen.");
  const company = await loadCompany();
  if (input.interest && company.dunning.baseRate === null) {
    throw new DunningError("Für Verzugszinsen bitte zuerst den Basiszinssatz in den Einstellungen eintragen.");
  }
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, input.invoiceId));
  if (!invoice?.seller || !invoice.buyer || !invoice.number) throw new DunningError("Rechnung nicht gefunden.");

  const amounts = dunningAmounts({
    open: listed.open,
    dueDate: invoice.dueDate,
    date: today,
    fee: input.fee,
    flatFee: input.flatFee,
    interestRate: input.interest ? company.dunning.baseRate! + DEFAULT_INTEREST_MARKUP[input.interest] : null,
  });
  const logo = await loadLogo();
  const pdf = buildDunningPdf({
    ...(logo ? { logo } : {}),
    level: input.level,
    date: today,
    dueDate: input.dueDate,
    seller: invoice.seller,
    buyer: invoice.buyer,
    invoice: { number: invoice.number, issueDate: invoice.issueDate, dueDate: invoice.dueDate },
    amounts,
    intro: input.intro,
    closing: input.closing,
  });
  return withActor(actor, async (tx) => {
    const [created] = await tx
      .insert(schema.dunnings)
      .values({
        invoiceId: invoice.id,
        level: input.level,
        date: today,
        dueDate: input.dueDate,
        ...amounts,
        intro: input.intro,
        closing: input.closing,
        pdf: Buffer.from(pdf),
        pdfSha256: createHash("sha256").update(pdf).digest("hex"),
      })
      .returning(dunningColumns);
    return created!;
  });
}

export async function loadDunningPdf(id: string) {
  const [row] = await db
    .select({ pdf: schema.dunnings.pdf, level: schema.dunnings.level, number: schema.invoices.number })
    .from(schema.dunnings)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.dunnings.invoiceId))
    .where(eq(schema.dunnings.id, id));
  if (!row) return null;
  return { pdf: row.pdf, filename: `${DUNNING_LEVELS[row.level as DunningLevel].title.replace(/ /g, "-")}-${row.number}.pdf` };
}
