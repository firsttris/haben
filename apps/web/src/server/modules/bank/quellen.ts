import { and, eq, gte, lte, notInArray } from "drizzle-orm";
import type { INTERNAL_PROVIDERS, StatementFormat } from "@haben/import";
import { schema, type Tx } from "../../db/index.ts";

/*
 * Ein Konto bekommt seine Umsätze aus einer Quelle (#632).
 *
 * Der Dubletten-Hash enthält das Buchungsdatum. Die Quellen schreiben es unterschiedlich — Accountable
 * das Zahlungsdatum, Swan das Buchungsdatum —, deshalb erkennt Haben beim Wechsel der Quelle keine
 * Dubletten und legt dieselbe Zahlung ein zweites Mal an. Beim Test von #627 waren von zwölf Umsätzen
 * eines Quartals acht doppelt, und aufgefallen ist es erst am Kontostand.
 */

/** Formate lesbar machen; als `Record<StatementFormat, …>` meldet tsc ein neues Format, das hier fehlt. */
const FORMAT_NAMEN: Record<StatementFormat, string> = {
  "dkb-csv": "DKB",
  "dkb-csv-alt": "DKB",
  "n26-csv": "N26",
  "swan-csv": "Swan",
  "commerzbank-csv": "Commerzbank",
  "bw-bank-csv": "BW-Bank",
  "ing-csv": "ING",
  "c24-csv": "C24",
  "deutsche-bank-group-csv": "Deutsche Bank",
  "csv-zuordnung": "CSV mit eigener Zuordnung",
  camt053: "CAMT.053",
  enablebanking: "Bankabruf",
  fints: "FinTS-Abruf",
  "accountable-xlsx": "Accountable",
  "paypal-csv": "PayPal",
  "paypal-api": "PayPal (Abruf)",
  "stripe-csv": "Stripe",
  "stripe-api": "Stripe (Abruf)",
  "shopify-payments-csv": "Shopify",
  "ebay-csv": "eBay",
  "etsy-csv": "Etsy",
  // Bewusst ein anderer Name als beim CSV-Import: Wer von der CSV auf den Abruf wechselt, wechselt die Quelle
  "etsy-ledger": "Etsy Payments (Abruf)",
  "googleplay-earnings": "Google Play",
  "appstore-finance": "App Store",
  "store-payout": "Store-Auszahlung",
  importvertrag: "REST-Import",
  "importvertrag-psp": "REST-Import",
};

/** Anbieter einer Quellenbindung (`import_sources.provider`, #306), wie die Meldung ihn nennt; tsc verlangt genau die Einträge aus INTERNAL_PROVIDERS */
const ABRUF_NAMEN: Record<string, string> = {
  enablebanking: "der Bankabruf",
  etsy: "der Etsy-Abruf",
  paypal: "der PayPal-Abruf",
  stripe: "der Stripe-Abruf",
} satisfies Record<(typeof INTERNAL_PROVIDERS)[number], string>;

/**
 * Meldet, wenn im Zeitraum des neuen Auszugs schon Umsätze aus einem anderen Dateiformat liegen und
 * der Import trotzdem Umsätze neu anlegt. Unscharf über Betrag und Datum verglichen wird bewusst
 * nicht: echte gleiche Zahlungen an Folgetagen blieben sonst unbemerkt.
 */
export async function quellenHinweis(
  tx: Tx,
  bankAccountId: string,
  format: StatementFormat,
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
  // Formate derselben Quelle (altes und neues DKB-CSV) erkennt der Dubletten-Hash gegenseitig; sie sind kein Wechsel
  const gleicheQuelle = (Object.keys(FORMAT_NAMEN) as StatementFormat[]).filter((f) => FORMAT_NAMEN[f] === FORMAT_NAMEN[format]);
  const fremd = await tx
    .select({ format: schema.bankImports.format, filename: schema.bankImports.filename })
    .from(schema.bankTransactions)
    .innerJoin(schema.bankImports, eq(schema.bankImports.id, schema.bankTransactions.importId))
    .where(
      and(
        eq(schema.bankTransactions.bankAccountId, bankAccountId),
        notInArray(schema.bankImports.format, gleicheQuelle),
        gte(schema.bankTransactions.bookingDate, von),
        lte(schema.bankTransactions.bookingDate, bis),
      ),
    )
    .groupBy(schema.bankImports.format, schema.bankImports.filename);
  if (fremd.length === 0) return null;
  const aus = fremd.map((f) => `${FORMAT_NAMEN[f.format as StatementFormat] ?? f.format} (${f.filename})`).join(", ");
  const neu = FORMAT_NAMEN[format];
  // Mit Stichtag (#306) ist die Quelle schon gewechselt: ab ihm kommen die Umsätze aus dem Abruf
  const [bindung] = await tx
    .select({ cutoverDate: schema.importSources.cutoverDate, provider: schema.importSources.provider })
    .from(schema.importSources)
    .where(and(eq(schema.importSources.bankAccountId, bankAccountId), lte(schema.importSources.cutoverDate, bis)));
  const weiter = bindung?.cutoverDate
    ? `Seit dem Stichtag ${bindung.cutoverDate} holt ${ABRUF_NAMEN[bindung.provider] ?? "der Abruf"} die Umsätze dieses Kontos; eine Datei braucht es danach nur für eine Lücke im Abruf.`
    : "Wer die Quelle wechselt, importiert ab dem Tag nach dem letzten vorhandenen Umsatz.";
  return `Für dieses Konto liegen im Zeitraum ${von} bis ${bis} schon Umsätze aus ${aus}. Der Auszug (${neu}) hat ${added} Umsätze neu angelegt; prüfe, ob sie doppelt sind. ${weiter}`;
}
