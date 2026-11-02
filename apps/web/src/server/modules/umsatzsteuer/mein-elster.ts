import { computeUstva, periodKey, toElsterSteuernummer } from "@haben/core";
import { buildUstvaUpload } from "@haben/elster";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/index.ts";
import { companyIssues, loadCompany } from "../stammdaten/index.ts";
import { VatError } from "./vat.ts";

/**
 * Die gespeicherte Voranmeldung als Datei für den XML-Import in Mein ELSTER. Der Weg ohne eigene Hersteller-ID:
 * Mein ELSTER füllt das Formular aus der Datei, geprüft und gesendet wird dort. Es zählen die Werte des gespeicherten
 * Entwurfs; Haben ändert dabei nichts.
 */
export async function meinElsterUpload(returnId: string): Promise<{ bytes: Uint8Array; filename: string }> {
  // Postgres lehnt eine ID ab, die keine UUID ist; für den Nutzer ist das dieselbe unbekannte Anmeldung
  const id = z.uuid().safeParse(returnId);
  const [vatReturn] = id.success ? await db.select().from(schema.vatReturns).where(eq(schema.vatReturns.id, id.data)) : [];
  if (!vatReturn) throw new VatError("Anmeldung nicht gefunden.");
  const company = await loadCompany();
  const issues = companyIssues(company);
  if (issues.length > 0) throw new VatError(`Firmendaten unvollständig: ${issues.join(", ")}.`);
  const period = { year: vatReturn.year, month: vatReturn.month };
  const bytes = buildUstvaUpload({
    period,
    steuernummer13: toElsterSteuernummer(company.steuernummer, company.bundesland!),
    figures: computeUstva(vatReturn),
    datenlieferant: { name: company.name, strasse: company.strasse, plz: company.plz, ort: company.ort },
    berichtigt: vatReturn.berichtigt,
  });
  return { bytes, filename: `UStVA_${periodKey(period)}${vatReturn.berichtigt ? "_berichtigt" : ""}.xml` };
}
