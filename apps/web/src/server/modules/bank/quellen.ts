import { and, eq, gte, lte, sql } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";

/*
 * Ein Konto bekommt seine Umsätze aus einer Quelle (#632).
 *
 * Der Dubletten-Hash enthält das Buchungsdatum. Die Quellen schreiben es unterschiedlich — Accountable
 * das Zahlungsdatum, Swan das Buchungsdatum —, deshalb erkennt Haben beim Wechsel der Quelle keine
 * Dubletten und legt dieselbe Zahlung ein zweites Mal an. Beim Test von #627 waren von zwölf Umsätzen
 * eines Quartals acht doppelt, und aufgefallen ist es erst am Kontostand.
 */

/** Formate lesbar machen; unbekannte Formate erscheinen mit ihrem technischen Namen. */
const FORMAT_NAMEN: Record<string, string> = {
  "swan-csv": "Swan",
  "accountable-xlsx": "Accountable",
  kontoauszug: "Kontoauszug",
  camt053: "CAMT.053",
  "dkb-csv": "DKB",
  "dkb-csv-alt": "DKB",
  "n26-csv": "N26",
  "paypal-csv": "PayPal",
  "stripe-csv": "Stripe",
  "ebay-csv": "eBay",
  "shopify-payments-csv": "Shopify",
  "etsy-csv": "Etsy",
};

/**
 * Meldet, wenn im Zeitraum des neuen Auszugs schon Umsätze aus einem anderen Dateiformat liegen und
 * der Import trotzdem Umsätze neu anlegt. Unscharf über Betrag und Datum verglichen wird bewusst
 * nicht: echte gleiche Zahlungen an Folgetagen blieben sonst unbemerkt.
 */
export async function quellenHinweis(
  tx: Tx,
  bankAccountId: string,
  format: string,
  added: number,
  periodFrom: string | null | undefined,
  periodTo: string | null | undefined,
  transactions: { bookingDate: string }[],
): Promise<string | null> {
  // Ohne neue Umsätze gibt es nichts zu melden; übersprungene sind bereits erkannt.
  if (added === 0 || transactions.length === 0) return null;
  const tage = transactions.map((t) => t.bookingDate).sort();
  const von = periodFrom ?? tage[0];
  const bis = periodTo ?? tage[tage.length - 1];
  if (!von || !bis) return null;
  const fremd = await tx
    .select({ format: schema.bankImports.format, filename: schema.bankImports.filename })
    .from(schema.bankTransactions)
    .innerJoin(schema.bankImports, eq(schema.bankImports.id, schema.bankTransactions.importId))
    .where(
      and(
        eq(schema.bankTransactions.bankAccountId, bankAccountId),
        sql`${schema.bankImports.format} <> ${format}`,
        gte(schema.bankTransactions.bookingDate, von),
        lte(schema.bankTransactions.bookingDate, bis),
      ),
    )
    .groupBy(schema.bankImports.format, schema.bankImports.filename);
  if (fremd.length === 0) return null;
  const aus = fremd.map((f) => `${FORMAT_NAMEN[f.format] ?? f.format} (${f.filename})`).join(", ");
  const neu = FORMAT_NAMEN[format] ?? format;
  return `Für dieses Konto liegen im Zeitraum ${von} bis ${bis} schon Umsätze aus ${aus}. Der Auszug (${neu}) hat ${added} Umsätze neu angelegt; prüfe, ob sie doppelt sind. Wer die Quelle wechselt, importiert ab dem Tag nach dem letzten vorhandenen Umsatz.`;
}
