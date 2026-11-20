import { and, desc, ne, type SQL, sql } from "drizzle-orm";
import { type Db, db, schema, type Tx } from "../../db/index.ts";
import { documentNotCancelled } from "../../db/document-cancelled.ts";
import { type Lieferant, lieferantGleich } from "./vorschlaege.ts";

/*
 * Hinweis auf eine mögliche Dublette (#1314, #1378): ein anderer, nicht stornierter Beleg desselben Lieferanten mit
 * derselben Rechnungsnummer. Eine Rechnungsnummer darf der Lieferant nur einmal vergeben (§ 14 Abs. 4 Satz 1 Nr. 4
 * UStG); eine doppelt erfasste Eingangsrechnung buchte die Ausgabe und die Vorsteuer doppelt. Nur ein Hinweis, keine
 * Sperre: Manche Lieferanten vergeben Nummern doppelt.
 */

/** Rechnungsnummer zum Vergleich, für Spalte und Eingabe derselbe Ausdruck: ohne Groß-/Kleinschreibung und Leerzeichen (auch geschützte) */
const nummerZumVergleich = (wert: SQL | typeof schema.documents.invoiceNumber) => sql`lower(regexp_replace(${wert}, '[[:space:]' || chr(160) || ']', '', 'g'))`;

export interface GleicheNummer {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  documentDate: string | null;
  gross: number;
  gebucht: boolean;
}

/** Was verglichen wird: der gespeicherte Beleg oder, beim Tippen, die Eingaben im Formular */
export interface Pruefling extends Lieferant {
  id: string;
  invoiceNumber: string;
  gross: number;
  recurringDocumentId: string | null;
}

/**
 * Andere Belege desselben Lieferanten (lieferantGleich: Kontakt, USt-IdNr. oder Name) mit derselben Rechnungsnummer,
 * jüngste zuerst, höchstens fünf. Nicht dazu zählen:
 * - stornierte Belege und ein Beleg ohne Nummer; ist der geprüfte Beleg selbst storniert, gibt es keinen Treffer;
 * - Belege derselben Vorlage: Ein Dauerbeleg trägt jeden Monat die Vertragsnummer als Rechnungsnummer;
 * - eine Gutschrift zu einer Rechnung mit derselben Nummer (anderes Vorzeichen des Betrags).
 */
export async function belegeMitGleicherNummer(beleg: Pruefling, q: Db | Tx = db): Promise<GleicheNummer[]> {
  const lieferant = lieferantGleich(beleg);
  if (!beleg.invoiceNumber.trim() || !lieferant) return [];
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
        sql`${nummerZumVergleich(schema.documents.invoiceNumber)} = ${nummerZumVergleich(sql`${beleg.invoiceNumber}::text`)}`,
        lieferant,
        documentNotCancelled(),
        // Ein stornierter Beleg steht nicht mehr doppelt in den Büchern, auch wenn er neu erfasst ist
        sql`not exists (select 1 from ${schema.documentCancellations} where ${schema.documentCancellations.documentId} = ${beleg.id})`,
        beleg.recurringDocumentId ? sql`${schema.documents.recurringDocumentId} is distinct from ${beleg.recurringDocumentId}` : undefined,
        beleg.gross !== 0 ? sql`sign(${schema.documents.gross}) <> ${-Math.sign(beleg.gross)}` : undefined,
      ),
    )
    .orderBy(desc(schema.documents.documentDate), desc(schema.documents.uploadedAt))
    .limit(5);
  return rows.map(({ status, ...row }) => ({ ...row, gebucht: status === "gebucht" }));
}
