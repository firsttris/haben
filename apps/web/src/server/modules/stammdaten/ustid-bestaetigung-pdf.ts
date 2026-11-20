import { germanDay } from "@haben/core";
import { buildUstidBestaetigungPdf } from "@haben/einvoice";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { loadCompany } from "./company.ts";

/**
 * Eine gespeicherte Antwort des BZSt zur USt-IdNr. als PDF (#1491), am Kontakt verlinkt in der Karte „Bestätigung beim
 * BZSt“. Entsteht beim Abruf und wird nicht gespeichert; null, wenn es die Antwort nicht gibt.
 */
export async function ustIdBestaetigungPdf(id: string, heute: string): Promise<{ pdf: Uint8Array; filename: string } | null> {
  const b = schema.ustidBestaetigungen;
  const [[row], company] = await Promise.all([
    db.select({ bestaetigung: b, kontakt: schema.contacts.name }).from(b).innerJoin(schema.contacts, eq(schema.contacts.id, b.contactId)).where(eq(b.id, id)),
    loadCompany(),
  ]);
  if (!row) return null;
  const { bestaetigung, kontakt } = row;
  const pdf = buildUstidBestaetigungPdf({ ...bestaetigung, kontakt, heute, firma: company.name });
  return { pdf, filename: `BZSt-${bestaetigung.angefragteUstid}-${germanDay(bestaetigung.anfrageZeitpunkt)}-${bestaetigung.art}.pdf` };
}
