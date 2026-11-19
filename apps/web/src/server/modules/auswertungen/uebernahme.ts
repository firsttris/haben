import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, type Tx } from "../../db/index.ts";
import { geprueft } from "../../errors.ts";
import { companySchema } from "../stammdaten/index.ts";
import { datevNumbersSchema } from "./datev-export.ts";
import { saveCompanyIn } from "./settings-guard.ts";

/*
 * Firmendaten und DATEV-Nummern aus der Einstellungsdatei einer anderen Instanz (#488) in der Transaktion des Aufrufers:
 * über saveCompanyIn mit denselben Prüfungen und Sperren wie das Formular. Die Instanz hat dabei noch keine Buchung
 * (instanzwechsel), die Sperren greifen also nicht. Bewusst gespeichert gilt nur, was es in der alten Instanz war.
 */

const gespeichertSchema = z.object({ companySavedAt: z.string().min(1).nullable() });

const datevSchema = z.object({
  datevBeraterNr: z.string(),
  datevMandantNr: z.string(),
  datevPersonenkontenAb: z.number().int().nullable(),
});

export async function firmendatenUebernehmen(tx: Tx, company: unknown, today: string): Promise<void> {
  const { companySavedAt } = geprueft(gespeichertSchema, company, "Firmendaten");
  await saveCompanyIn(tx, geprueft(companySchema, company, "Firmendaten"), today, { bewusst: companySavedAt !== null });
  const datev = geprueft(datevSchema, company, "DATEV-Nummern");
  // Leer heißt nicht eingetragen; das Formular verlangt beide Nummern erst, wenn man sie einträgt
  if (datev.datevBeraterNr || datev.datevMandantNr) {
    const { beraterNr, mandantNr } = geprueft(
      datevNumbersSchema,
      { beraterNr: datev.datevBeraterNr, mandantNr: datev.datevMandantNr, personenkontenAb: datev.datevPersonenkontenAb },
      "DATEV-Nummern",
    );
    await tx.update(schema.company).set({ datevBeraterNr: beraterNr, datevMandantNr: mandantNr }).where(eq(schema.company.id, 1));
  }
  if (datev.datevPersonenkontenAb !== null) {
    const { personenkontenAb } = geprueft(
      datevNumbersSchema.pick({ personenkontenAb: true }),
      { personenkontenAb: datev.datevPersonenkontenAb },
      "DATEV-Personenkonten",
    );
    await tx
      .update(schema.company)
      .set({ datevPersonenkontenAb: personenkontenAb ?? null })
      .where(eq(schema.company.id, 1));
  }
}
