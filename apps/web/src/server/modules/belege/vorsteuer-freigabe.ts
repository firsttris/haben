import { ACCOUNTS, leistungsdatum, vorsteuerAusgleichPosting, type TaxCode, type TaxShare } from "@haben/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";
import { post } from "../buchhaltung/index.ts";

/** Buchhaltungsrahmen, wie `post` ihn erwartet (Kontenrahmen und Rechtsform der Firma) */
type Books = Parameters<typeof post>[1];

/*
 * Vorsteuer aus einem Leistungszeitraum, der beim Buchen noch nicht ausgeführt war (#693): Sie liegt auf dem
 * Zwischenkonto (SKR03 1548, SKR04 1434) und gehört in den Monat der Ausführung, nicht in den der Zahlung. Wer auf Ziel
 * zahlt, bekäme sie sonst erst im Folgejahr — bei Zahlungsziel Januar ginge die Vorsteuer des Vorjahres an der
 * Voranmeldung vorbei, obwohl § 15 Abs. 1 Satz 1 Nr. 1 UStG mit Leistung und Rechnung erfüllt ist.
 *
 * Deshalb schreibt Haben beim Buchen eine zweite Buchung mit dem Datum der Ausführung; sie zieht die Vorsteuer vom
 * Zwischenkonto auf das Vorsteuerkonto, und Kz 66 sieht sie in diesem Monat. Die Zahlung bucht danach nur noch
 * Verbindlichkeit gegen Bank: Der Ausgleich (vorsteuer-ausgleich.ts) findet nichts mehr vor, weil er das Journal liest.
 *
 * Nicht hierher gehören Gutschriften, die bereits Bezahltes erstatten (#786, § 17 Abs. 1 UStG): Ihre Minderung hängt am
 * Ausgleich, nicht an der Ausführung. § 13b, innergemeinschaftlicher Erwerb und Einfuhrumsatzsteuer haben ihren eigenen
 * Zeitpunkt; `leistungNochNichtAusgefuehrt` in belegbuchung.ts lässt sie deshalb schon nicht auf das Zwischenkonto.
 */

/** Beide Konten dieses Zwischenkontos, damit ein Wechsel des Kontenrahmens die Buchung nicht verliert */
const ZWISCHENKONTEN = [ACCOUNTS.SKR03.vorsteuerNochNichtAbziehbar, ACCOUNTS.SKR04.vorsteuerNochNichtAbziehbar];

/** Steuersatz zum Steuerschlüssel; das Zwischenkonto trägt 19 % und 7 % */
function satzZumSchluessel(code: string | null): number | null {
  if (code === "VSt19") return 1900;
  if (code === "VSt7") return 700;
  return null;
}

/** Was die Buchung des Belegs auf das Zwischenkonto gelegt hat, je Steuersatz (Soll positiv) */
async function geparkt(tx: Tx, entryId: string): Promise<TaxShare[]> {
  const rows = await tx.execute<{ tax_code: string | null; betrag: number; basis: number }>(sql`
    select l.tax_code, sum(l.debit - l.credit)::int as betrag, coalesce(sum(l.basis), 0)::int as basis
      from journal_lines l
     where l.entry_id = ${entryId} and (l.account = ${ZWISCHENKONTEN[0]!} or l.account = ${ZWISCHENKONTEN[1]!})
     group by l.tax_code`);
  return [...rows].flatMap((r) => {
    const rate = satzZumSchluessel(r.tax_code);
    const tax = Number(r.betrag);
    return rate === null || tax === 0 ? [] : [{ rate, base: Number(r.basis), tax }];
  });
}

/**
 * Gibt die beim Buchen geparkte Vorsteuer im Monat der Ausführung frei. Liefert die ID der Buchung oder null, wenn es
 * nichts freizugeben gibt: keine Leistung nach dem Belegdatum, keine Steuer auf dem Zwischenkonto, schon freigegeben,
 * oder das Jahr der Ausführung ist abgeschlossen (dann bleibt es beim Ausgleich mit der Zahlung).
 */
export async function freigabeAmAusfuehrung(
  tx: Tx,
  doc: {
    id: string;
    documentDate: string | null;
    serviceFrom: string | null;
    serviceTo: string | null;
    invoiceNumber: string | null;
    supplierName: string | null;
  },
  books: Books,
  entryId: string,
): Promise<string | null> {
  if (!doc.documentDate) return null;
  const am = leistungsdatum({ belegdatum: doc.documentDate, leistungVon: doc.serviceFrom, leistungBis: doc.serviceTo });
  // Nur ein Zeitraum nach dem Belegdatum parkt überhaupt; sonst gilt der Belegmonat
  if (am <= doc.documentDate) return null;

  const anteile = await geparkt(tx, entryId);
  if (anteile.length === 0) return null;

  // Je Beleg eine Freigabe; ein Storno der Freigabe zählt nicht als Freigabe
  const [schon] = await tx
    .select({ id: schema.journalEntries.id })
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.sourceType, "freigabe"), eq(schema.journalEntries.sourceId, doc.id), isNull(schema.journalEntries.reversesId)));
  if (schon) return null;

  try {
    return await post(tx, books, {
      date: am,
      description: `Vorsteuer aus Leistungszeitraum: ${doc.supplierName ?? "Beleg"}${doc.invoiceNumber ? ` · ${doc.invoiceNumber}` : ""}`,
      sourceType: "freigabe",
      sourceId: doc.id,
      // Umgekehrte Richtung des Parkens: Haben Zwischenkonto, Soll Vorsteuer
      lines: vorsteuerAusgleichPosting(
        anteile.map((a) => ({ rate: a.rate, base: -a.base, tax: -a.tax })),
        books.kontenrahmen,
      ),
    });
  } catch {
    // Abgeschlossenes Jahr: Dann bleibt es beim Ausgleich mit der Zahlung, statt die Buchung des Belegs scheitern zu lassen
    return null;
  }
}

/**
 * Dreht die Freigabe beim Storno eines Belegs zurück. Am Tag des Stornos, aber nie vor der Freigabe selbst: Eine
 * Freigabe, die erst mit der Ausführung fällig wäre, wird in ihrem eigenen Monat aufgehoben, damit dort keine Minderung
 * ohne Gegenstück entsteht.
 */
export async function freigabeStornieren(tx: Tx, books: Books, documentId: string, stornoAm: string): Promise<number> {
  const offen = await tx
    .select({ id: schema.journalEntries.id, date: schema.journalEntries.date, description: schema.journalEntries.description })
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.sourceType, "freigabe"), eq(schema.journalEntries.sourceId, documentId), isNull(schema.journalEntries.reversesId)));
  let anzahl = 0;
  for (const freigabe of offen) {
    const date = freigabe.date > stornoAm ? freigabe.date : stornoAm;
    const zeilen = await tx
      .select({
        account: schema.journalLines.account,
        debit: schema.journalLines.debit,
        credit: schema.journalLines.credit,
        taxCode: schema.journalLines.taxCode,
        basis: schema.journalLines.basis,
      })
      .from(schema.journalLines)
      .where(eq(schema.journalLines.entryId, freigabe.id));
    await post(tx, books, {
      date,
      description: `Storno: ${freigabe.description ?? "Vorsteuer aus Leistungszeitraum"}`,
      sourceType: "freigabe",
      sourceId: documentId,
      reversesId: freigabe.id,
      lines: zeilen.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit, taxCode: l.taxCode as TaxCode | null, basis: l.basis })),
    });
    anzahl += 1;
  }
  return anzahl;
}
