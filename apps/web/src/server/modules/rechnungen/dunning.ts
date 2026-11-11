import { UserError } from "../../errors.ts";
import { addDays, DEFAULT_INTEREST_MARKUP, DUNNING_LEVELS, DUNNING_TEXTS, dunningAmounts, type DunningLevel } from "@haben/core";
import { buildDunningDraftPdf, buildDunningPdf, type DraftPdf, type DunningDocument } from "@haben/einvoice";
import { desc, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { loadCompany } from "../stammdaten/index.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { listInvoices, withCurrentLegalInfo } from "./invoices.ts";
import { loadLetterhead, withCustomLayout } from "../stammdaten/index.ts";

export class DunningError extends UserError {}

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
  return db
    .select(dunningColumns)
    .from(schema.dunnings)
    .where(inArray(schema.dunnings.invoiceId, invoiceIds))
    .orderBy(desc(schema.dunnings.date), desc(schema.dunnings.createdAt));
}

const nextLevel = (last: Pick<Dunning, "level"> | undefined): DunningLevel => Math.min((last?.level ?? 0) + 1, 3) as DunningLevel;

/**
 * Überfällige Rechnungen mit ihrer letzten Mahnung. „Frist läuft“, solange die Frist der letzten
 * Mahnung noch nicht abgelaufen ist.
 */
export async function overdueInvoices(today: string) {
  const overdue = owed(await listInvoices(today)).filter((i) => i.listStatus === "ueberfaellig" && i.open > 0);
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

/**
 * Was der Kunde je Rechnung schuldet: deren offener Betrag abzüglich der noch offenen Korrekturen (Gutschriften).
 * In der Rechnungsliste stehen beide getrennt, gemahnt wird nur der Rest.
 */
function owed(list: Awaited<ReturnType<typeof listInvoices>>) {
  return list.map((invoice) => {
    if (invoice.kind !== "rechnung") return invoice;
    const corrections = list.filter((c) => c.kind === "korrektur" && c.correctsId === invoice.id);
    return { ...invoice, open: invoice.open + corrections.reduce((sum, c) => sum + c.open, 0) };
  });
}

/** Festgeschriebene Rechnung mit dem, was der Kunde schuldet; undefined, wenn es keine mit dieser Id gibt */
async function finalInvoice(invoiceId: string, today: string) {
  const invoice = owed(await listInvoices(today)).find((i) => i.id === invoiceId);
  return invoice?.status === "final" ? invoice : undefined;
}

function assertOpen<T extends { kind: string; open: number }>(invoice: T): T {
  if (invoice.kind !== "rechnung" || invoice.open <= 0) throw new DunningError("Für diese Rechnung ist nichts offen.");
  return invoice;
}

async function openInvoice(invoiceId: string, today: string) {
  const invoice = await finalInvoice(invoiceId, today);
  if (!invoice) throw new DunningError("Rechnung nicht gefunden.");
  return assertOpen(invoice);
}

/**
 * Vorschlag für eine neue Mahnung: nächste Stufe, Frist, Gebühr und Texte aus den Einstellungen. null, wenn es die
 * Rechnung nicht gibt: Die Mahnungsseite zeigt dann 404 wie jede Detailseite.
 */
export async function dunningDraft(invoiceId: string, today: string) {
  const found = await finalInvoice(invoiceId, today);
  if (!found) return null;
  const invoice = assertOpen(found);
  const { dunning } = await loadCompany();
  const [last] = await dunningsFor([invoiceId]);
  const level = nextLevel(last);
  return {
    invoice: {
      id: invoice.id,
      number: invoice.number!,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      customer: invoice.customer,
      open: invoice.open,
    },
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

/** Prüfungen vor jeder Mahnung, auch vor dem Entwurf: offen, fällig, Frist in der Zukunft, Basiszins für Zinsen */
async function checkedInput(input: DunningInput, today: string) {
  const listed = await openInvoice(input.invoiceId, today);
  if (listed.dueDate >= today) throw new DunningError("Die Rechnung ist noch nicht fällig.");
  if (input.dueDate <= today) throw new DunningError("Die neue Zahlungsfrist muss in der Zukunft liegen.");
  const company = await loadCompany();
  if (input.interest && company.dunning.baseRate === null) {
    throw new DunningError("Für Verzugszinsen bitte zuerst den Basiszinssatz in den Einstellungen eintragen.");
  }
  return { open: listed.open, company, letterhead: await loadLetterhead() };
}

/**
 * Inhalt der Mahnung zum heutigen Stand. Mit `lock` sperrt sie die Rechnung und liest die letzte Mahnung erst danach:
 * Zwei gleichzeitige Mahnungen derselben Stufe sind so ausgeschlossen. Der Entwurf liest nur.
 */
async function dunningDocument(
  q: Db | Tx,
  input: DunningInput,
  today: string,
  { open, company, letterhead }: Awaited<ReturnType<typeof checkedInput>>,
  lock: boolean,
): Promise<DunningDocument> {
  const query = q.select().from(schema.invoices).where(eq(schema.invoices.id, input.invoiceId));
  const [invoice] = await (lock ? query.for("update") : query);
  if (!invoice?.seller || !invoice.buyer || !invoice.number) throw new DunningError("Rechnung nicht gefunden.");
  // Offen ist der Euro-Betrag aus dem Kurs der Rechnung; der Kunde schuldet aber die Fremdwährung
  if (invoice.currency !== "EUR") throw new DunningError(`Mahnungen für Rechnungen in ${invoice.currency} erstellt Haben nicht; bitte selbst mahnen.`);
  const [last] = await q
    .select({ level: schema.dunnings.level })
    .from(schema.dunnings)
    .where(eq(schema.dunnings.invoiceId, invoice.id))
    .orderBy(desc(schema.dunnings.date), desc(schema.dunnings.createdAt))
    .limit(1);
  const allowed = nextLevel(last);
  if (input.level < allowed) {
    throw new DunningError(
      `Die Rechnung ist schon mit „${DUNNING_LEVELS[last!.level as DunningLevel].label}“ gemahnt. Als Nächstes folgt „${DUNNING_LEVELS[allowed].label}“.`,
    );
  }
  return {
    ...letterhead,
    level: input.level,
    date: today,
    dueDate: input.dueDate,
    seller: withCurrentLegalInfo(invoice.seller, company),
    buyer: invoice.buyer,
    // Gemahnt wird erst nach der Fälligkeit, also nach jeder Skontofrist: dann gilt der volle Betrag
    invoice: { number: invoice.number, issueDate: invoice.issueDate, dueDate: invoice.dueDate, skontoExpired: invoice.skonto.length > 0 },
    amounts: dunningAmounts({
      open,
      dueDate: invoice.dueDate,
      date: today,
      fee: input.fee,
      flatFee: input.flatFee,
      interestRate: input.interest ? company.dunning.baseRate! + DEFAULT_INTEREST_MARKUP[input.interest] : null,
    }),
    intro: input.intro,
    closing: input.closing,
  };
}

/**
 * Mahnung als Entwurfs-PDF (Issue #342) mit denselben Prüfungen und Beträgen wie beim Erstellen, aber ohne sie zu
 * speichern: Die Mahnstufe bleibt frei, nichts wird versendet
 */
export async function dunningDraftPdf(input: DunningInput, today: string): Promise<DraftPdf> {
  const checked = await checkedInput(input, today);
  const doc = await dunningDocument(db, input, today, checked, false);
  return withCustomLayout("mahnung", doc, (letterhead) => buildDunningDraftPdf({ ...doc, ...letterhead }));
}

/** Erstellt die Mahnung mit PDF; Beträge werden zum heutigen Stand berechnet */
export async function createDunning(actor: string, input: DunningInput, today: string): Promise<Dunning> {
  const checked = await checkedInput(input, today);
  return withActor(actor, async (tx) => {
    const doc = await dunningDocument(tx, input, today, checked, true);
    const pdf = await withCustomLayout("mahnung", doc, (letterhead) => buildDunningPdf({ ...doc, ...letterhead }));
    const [created] = await tx
      .insert(schema.dunnings)
      .values({
        invoiceId: input.invoiceId,
        level: input.level,
        date: today,
        dueDate: input.dueDate,
        ...doc.amounts,
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
