import { isValidIdnr } from "@haben/elster";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { loadCompany } from "./company.ts";
import { withActor } from "./db/actor.ts";
import { schema } from "./db/index.ts";
import type { TaxpayerData } from "./db/schema.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum im Format JJJJ-MM-TT");

export const personSchema = z.object({
  idnr: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, ""))
    .refine(isValidIdnr, "Die Identifikationsnummer ist ungültig (11 Ziffern mit Prüfziffer)"),
  anrede: z.enum(["Herrn", "Frau"]),
  vorname: z.string().trim().min(1, "Vorname fehlt").max(100),
  name: z.string().trim().min(1, "Name fehlt").max(100),
  geburtsdatum: isoDate,
  religion: z.string().trim().max(2).default("11"),
  beruf: z.string().trim().max(100).default(""),
});

export const taxpayerSchema = z
  .object({
    a: personSchema.optional(),
    b: personSchema.optional(),
    veranlagung: z.enum(["einzel", "zusammen"]).optional(),
    verheiratetSeit: isoDate.optional(),
  })
  .refine((t) => t.veranlagung !== "zusammen" || t.b, { message: "Für die Zusammenveranlagung fehlen die Angaben zum Ehegatten", path: ["b"] });

export type TaxpayerInput = z.input<typeof taxpayerSchema>;

export async function loadTaxpayer(): Promise<TaxpayerData> {
  return (await loadCompany()).taxpayer;
}

export async function saveTaxpayer(actor: string, input: TaxpayerInput): Promise<TaxpayerData> {
  const data = taxpayerSchema.parse(input);
  await loadCompany();
  await withActor(actor, (tx) =>
    tx.update(schema.company).set({ taxpayer: data, updatedAt: new Date() }).where(eq(schema.company.id, 1)),
  );
  return data;
}
