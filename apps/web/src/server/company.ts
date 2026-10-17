import { BUNDESLAENDER, EXPENSE_CATEGORY_KEYS, toElsterSteuernummer, SteuernummerError, type Versteuerung } from "@haben/core";
import { and, desc, eq, gte, lt, lte, min } from "drizzle-orm";
import { z } from "zod";
import { listArticles } from "./articles.ts";
import { listContacts } from "./contacts.ts";
import { withActor } from "./db/actor.ts";
import { db, schema, type Db, type Tx } from "./db/index.ts";
import { logoInfo } from "./logo.ts";

export const companySchema = z.object({
  name: z.string().trim().max(200),
  strasse: z.string().trim().max(200),
  plz: z.string().trim().regex(/^(\d{5})?$/, "PLZ hat fünf Ziffern"),
  ort: z.string().trim().max(100),
  email: z.union([z.literal(""), z.string().trim().pipe(z.email("Keine gültige E-Mail-Adresse").max(320))]),
  steuernummer: z.string().trim().max(20),
  ustId: z.union([z.literal(""), z.string().trim().regex(/^DE\d{9}$/, "USt-IdNr. hat die Form DE123456789")]),
  finanzamt: z.string().trim().max(200),
  bundesland: z.enum(Object.keys(BUNDESLAENDER) as [keyof typeof BUNDESLAENDER, ...(keyof typeof BUNDESLAENDER)[]]).nullable(),
  versteuerung: z.enum(["ist", "soll"]),
  telefon: z.string().trim().max(40),
  bank: z.string().trim().max(100),
  iban: z.union([z.literal(""), z.string().trim().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, "IBAN ohne Leerzeichen")]),
  bic: z.union([z.literal(""), z.string().trim().regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/, "BIC hat 8 oder 11 Zeichen")]),
  kontenrahmen: z.enum(["SKR03", "SKR04"]),
  paymentTermDays: z.number().int().min(0).max(120),
  defaultFormat: z.enum(["zugferd", "xrechnung-cii", "xrechnung-ubl"]),
  kleinunternehmer: z.boolean(),
  /** Anlage EÜR: Gewerbebetrieb oder selbständige (freiberufliche) Arbeit und Art des Betriebs */
  einkunftsart: z.enum(["gewerbe", "selbstaendig"]).nullable().default(null),
  taetigkeit: z.string().trim().max(100).default(""),
  /** Vorgabe für den Privatanteil je Belegkategorie in Prozent */
  privateShares: z.partialRecord(z.enum(EXPENSE_CATEGORY_KEYS), z.number().int().min(0).max(100)).default({}),
  dunning: z
    .object({
      baseRate: z.number().int().min(-1_000).max(2_000).nullable(),
      fees: z.object({ "1": z.number().int().min(0).max(100_000), "2": z.number().int().min(0).max(100_000), "3": z.number().int().min(0).max(100_000) }),
      deadlineDays: z.number().int().min(1).max(60),
    })
    .default({ baseRate: null, fees: { "1": 0, "2": 0, "3": 0 }, deadlineDays: 10 }),
});

export type CompanyInput = z.infer<typeof companySchema>;
export type Company = typeof schema.company.$inferSelect;

/** Firmendaten; mit `q` in einer laufenden Transaktion gelesen. Fehlt die Zeile, wird sie mit den Vorgaben angelegt. */
export async function loadCompany(q: Db | Tx = db): Promise<Company> {
  const [row] = await q.select().from(schema.company).where(eq(schema.company.id, 1));
  if (row) return row;
  const insert = (w: Db | Tx) => w.insert(schema.company).values({ id: 1 }).onConflictDoNothing().returning();
  const [created] = q === db ? await withActor("system:setup", insert) : await insert(q);
  return created ?? (await loadCompany(q));
}

/**
 * Versteuerung (Ist oder Soll), nach der ein Jahr gebucht ist. Umstellen geht nur zum Jahreswechsel, bevor im neuen
 * Jahr gebucht wird (settings-guard.ts); es gilt also, was beim Anlegen der ersten Buchung des Jahres eingestellt war.
 * Das steht im Audit-Log der Firmendaten. Ohne Buchung im Jahr gilt die aktuelle Einstellung.
 *
 * Wichtig für alles, was frühere Zeiträume rechnet: Voranmeldungen des Vorjahres und vor allem die
 * Umsatzsteuererklärung, die erst im Folgejahr abgegeben wird, nach einem Wechsel also schon unter der neuen Einstellung.
 */
export async function versteuerungForYear(year: number): Promise<Versteuerung> {
  const [first] = await db
    .select({ at: min(schema.journalEntries.createdAt) })
    .from(schema.journalEntries)
    .where(and(gte(schema.journalEntries.date, `${year}-01-01`), lt(schema.journalEntries.date, `${year + 1}-01-01`)));
  if (first?.at) {
    const [setting] = await db
      .select({ newValue: schema.auditLog.newValue })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tableName, "company"), lte(schema.auditLog.at, first.at)))
      .orderBy(desc(schema.auditLog.seq))
      .limit(1);
    const value = (setting?.newValue as { versteuerung?: unknown } | null)?.versteuerung;
    if (value === "ist" || value === "soll") return value;
  }
  return (await loadCompany()).versteuerung;
}

/** Gemeinsame Daten für den Rechnungs- und den Angebotseditor, mit der letzten vergebenen Nummer je Jahr */
export async function editorContext(kind: "rechnung" | "angebot") {
  const [company, counters, contacts, articles, logo] = await Promise.all([
    loadCompany(),
    kind === "rechnung" ? db.select().from(schema.invoiceNumberCounters) : db.select().from(schema.quoteNumberCounters),
    listContacts(),
    listArticles(),
    logoInfo(),
  ]);
  const { name, strasse, plz, ort, email, steuernummer, ustId, iban, bic, bank } = company;
  return {
    contacts,
    articles: articles.map(({ id, number, description, unit, unitPrice, taxRate, priceIncludesTax }) => ({
      id,
      number,
      description,
      unit,
      unitPrice,
      taxRate,
      priceIncludesTax,
    })),
    company: { name, strasse, plz, ort, email, steuernummer, ustId, iban, bic, bank, logo: logo?.sha256 ?? null },
    sellerIssues: sellerIssues(company),
    bundesland: company.bundesland,
    kleinunternehmer: company.kleinunternehmer,
    numberCounters: Object.fromEntries(counters.map((c) => [c.year, c.last])) as Record<number, number>,
  };
}

/** Was fehlt, bevor eine Voranmeldung gesendet werden kann. */
export function companyIssues(company: Company): string[] {
  const issues: string[] = [];
  if (!company.name) issues.push("Name fehlt");
  if (!company.strasse || !company.plz || !company.ort) issues.push("Anschrift unvollständig");
  if (!company.bundesland) issues.push("Bundesland fehlt");
  if (!company.steuernummer) {
    issues.push("Steuernummer fehlt");
  } else if (company.bundesland) {
    try {
      toElsterSteuernummer(company.steuernummer, company.bundesland);
    } catch (error) {
      if (error instanceof SteuernummerError) issues.push(error.message);
      else throw error;
    }
  }
  return issues;
}

/** Was auf einer Rechnung als Absender fehlt (§ 14 UStG und Zahlungsangaben). */
export function sellerIssues(company: Company): string[] {
  const issues: string[] = [];
  if (!company.name) issues.push("Firmenname fehlt");
  if (!company.strasse || !company.plz || !company.ort) issues.push("Anschrift unvollständig");
  if (!company.steuernummer && !company.ustId) issues.push("Steuernummer oder USt-IdNr. fehlt");
  if (!company.email) issues.push("E-Mail-Adresse fehlt");
  if (!company.iban) issues.push("IBAN fehlt");
  return issues;
}
