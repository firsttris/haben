import { and, desc, eq, ne, or, type SQL, sql } from "drizzle-orm";
import { type Db, db, schema, type Tx } from "../../db/index.ts";
import { documentNotCancelled } from "../../db/document-cancelled.ts";

/*
 * Hinweis auf eine mögliche Dublette (#1314, #1378): ein anderer, nicht stornierter Beleg desselben Lieferanten mit
 * derselben Rechnungsnummer. Eine Rechnungsnummer darf der Lieferant nur einmal vergeben (§ 14 Abs. 4 Satz 1 Nr. 4
 * UStG); eine doppelt erfasste Eingangsrechnung zöge die Vorsteuer doppelt. Nur ein Hinweis, keine Sperre: Manche
 * Lieferanten vergeben Nummern doppelt, und eine Gutschrift kann die Nummer der Rechnung tragen.
 */

/** Rechnungsnummer zum Vergleich: ohne Groß- und Kleinschreibung und ohne Leerzeichen */
export function nummerZumVergleich(nummer: string): string {
  return nummer.replace(/\s/g, "").toLowerCase();
}

/** Lieferantenname zum Vergleich: ohne Groß- und Kleinschreibung, Leerzeichen zusammengefasst */
function nameZumVergleich(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface GleicheNummer {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  documentDate: string | null;
  gross: number;
  gebucht: boolean;
}

type Beleg = { id: string; invoiceNumber: string; supplierContactId: string | null; supplierUstId: string; supplierName: string };

/**
 * Andere Belege desselben Lieferanten mit derselben Rechnungsnummer, jüngste zuerst. Derselbe Lieferant heißt: derselbe
 * Kontakt, sonst dieselbe USt-IdNr., sonst derselbe Name; so greift der Hinweis auch, bevor der Lieferant als Kontakt
 * gewählt ist (Auslesung, E-Rechnung). Ohne Nummer oder ohne Lieferant gibt es nichts zu vergleichen.
 */
export async function belegeMitGleicherNummer(beleg: Beleg, q: Db | Tx = db): Promise<GleicheNummer[]> {
  const nummer = nummerZumVergleich(beleg.invoiceNumber);
  const ustId = nummerZumVergleich(beleg.supplierUstId);
  const name = nameZumVergleich(beleg.supplierName);
  const lieferant: SQL[] = [];
  if (beleg.supplierContactId) lieferant.push(eq(schema.documents.supplierContactId, beleg.supplierContactId));
  if (ustId) lieferant.push(sql`lower(regexp_replace(${schema.documents.supplierUstId}, '\\s', '', 'g')) = ${ustId}`);
  if (name) lieferant.push(sql`lower(regexp_replace(trim(${schema.documents.supplierName}), '\\s+', ' ', 'g')) = ${name}`);
  if (!nummer || lieferant.length === 0) return [];
  const rows = await q
    .select({
      id: schema.documents.id,
      invoiceNumber: schema.documents.invoiceNumber,
      supplierName: schema.documents.supplierName,
      documentDate: schema.documents.documentDate,
      gross: schema.documents.gross,
      status: schema.documents.status,
    })
    .from(schema.documents)
    .where(
      and(
        ne(schema.documents.id, beleg.id),
        sql`lower(regexp_replace(${schema.documents.invoiceNumber}, '\\s', '', 'g')) = ${nummer}`,
        or(...lieferant),
        documentNotCancelled(),
      ),
    )
    .orderBy(desc(schema.documents.documentDate), desc(schema.documents.uploadedAt))
    .limit(5);
  return rows.map(({ status, ...row }) => ({ ...row, gebucht: status === "gebucht" }));
}
