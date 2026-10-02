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
