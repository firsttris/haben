import { BUNDESLAENDER, toElsterSteuernummer, SteuernummerError } from "@haben/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db/index.ts";

export const companySchema = z.object({
  name: z.string().trim().max(200),
  strasse: z.string().trim().max(200),
  plz: z.string().trim().regex(/^(\d{5})?$/, "PLZ hat fünf Ziffern"),
  ort: z.string().trim().max(100),
  email: z.union([z.literal(""), z.string().trim().email("Keine gültige E-Mail-Adresse")]),
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
  privateShares: z.record(z.string(), z.number().int().min(0).max(100)).default({}),
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

export async function loadCompany(): Promise<Company> {
  const [row] = await db.select().from(schema.company).where(eq(schema.company.id, 1));
  if (row) return row;
  const [created] = await db.insert(schema.company).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await loadCompany());
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
