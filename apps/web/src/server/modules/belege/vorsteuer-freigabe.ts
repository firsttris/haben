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
 * Wird vor der Ausführung gezahlt, ist die Vorsteuer schon mit der Zahlung abziehbar: § 15 Abs. 1 Satz 1 Nr. 1 Satz 3
 * UStG verlangt Rechnung und Zahlung, nicht die Ausführung (Abschnitt 15.3 UStAE). Dann gibt die Zahlung selbst frei,
 * und die Freigabe zur Ausführung unterbleibt — sonst stünde dieselbe Steuer zweimal in der Voranmeldung. Bei
 * Teilzahlungen gilt das je Zahlung für ihren Anteil; der Rest kommt mit der Ausführung.
 *
 * Nicht hierher gehören Gutschriften, die bereits Bezahltes erstatten (#786, § 17 Abs. 1 UStG): Ihre Minderung hängt am
 * Ausgleich, nicht an der Ausführung. § 13b, innergemeinschaftlicher Erwerb und Einfuhrumsatzsteuer haben ihren eigenen
 * Zeitpunkt; `leistungNochNichtAusgefuehrt` in belegbuchung.ts lässt sie deshalb schon nicht auf das Zwischenkonto.
 */

/** Trägt der Beleg schon eine wirksame Freigabe (ein Storno zählt nicht)? */
export async function schonFreigegeben(tx: Tx, documentId: string): Promise<boolean> {
  const [schon] = await tx
    .select({ id: schema.journalEntries.id })
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.sourceType, "freigabe"), eq(schema.journalEntries.sourceId, documentId), isNull(schema.journalEntries.reversesId)));
  return schon !== undefined;
}

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
  // Zahlung vor der Ausführung (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 3 UStG, #930): Dann gibt die Zahlung frei, und hier
  // bleibt es dabei. Das gilt auch für einen Teil, der schon gezahlt ist, während der Rest auf Ziel steht.
  const [ersteZahlung] = await tx
    .select({ date: schema.allocations.date })
    .from(schema.allocations)
    .where(and(eq(schema.allocations.documentId, doc.id), isNull(schema.allocations.reversesId)))
    .orderBy(schema.allocations.date)
    .limit(1);
  if (ersteZahlung?.date && ersteZahlung.date < am) return null;

  const anteile = await geparkt(tx, entryId);
  if (anteile.length === 0) return null;

  // Je Beleg eine Freigabe; ein Storno der Freigabe zählt nicht als Freigabe
  if (await schonFreigegeben(tx, doc.id)) return null;

  // Abgeschlossenes Jahr: Dann bleibt es beim Ausgleich mit der Zahlung, statt die Buchung des Belegs scheitern zu
  // lassen. Nur dieser eine Fall wird vorher geprüft; ein LedgerError kann auch vom Wechsel des Kontenrahmens oder von
  // geänderten Firmendaten kommen, und der darf nicht stillschweigend eine Buchung verschlucken.
  const [geschlossen] = await tx
    .select({ year: schema.yearClosings.year })
    .from(schema.yearClosings)
    .where(eq(schema.yearClosings.year, Number(am.slice(0, 4))));
  if (geschlossen) return null;

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

/**
 * Gibt die geparkte Vorsteuer für eine Zahlung frei, die vor der Ausführung eingeht (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 3
 * UStG, #930). Gebucht wird am Tag der Zahlung, und zwar nur für den Anteil, den diese Zahlung trifft: Wer 40 % anzahlt,
 * zieht 40 % der Steuer; der Rest kommt mit der Ausführung. Die Freigabe ist dieselbe Buchungsart wie die zur Ausführung,
 * damit der Ausgleich sie im Journal (`bisherUmgebucht`) sicher wiederfindet und nicht ein zweites Mal zieht.
 *
 * `anteil` ist die Steuer, die auf diese Zahlung entfällt (wie `vorsteuerRest` sie rechnet). Ohne Anteil, bei einem schon
 * freigegebenen Beleg und bei einem abgeschlossenen Zahlungsjahr passiert nichts.
 */
export async function freigabeMitZahlung(
  tx: Tx,
  doc: { id: string; invoiceNumber: string | null; supplierName: string | null },
  books: Books,
  anteil: TaxShare[] | null,
  zahlungAm: string,
): Promise<boolean> {
  if (anteil === null || anteil.length === 0) return false;
  if (await schonFreigegeben(tx, doc.id)) return false;
  const [geschlossen] = await tx
    .select({ year: schema.yearClosings.year })
    .from(schema.yearClosings)
    .where(eq(schema.yearClosings.year, Number(zahlungAm.slice(0, 4))));
  if (geschlossen) return false;

  const anteile = anteil.filter((a) => a.tax !== 0);
  if (anteile.length === 0) return false;

  await post(tx, books, {
    date: zahlungAm,
    description: `Vorsteuer aus Anzahlung: ${doc.supplierName ?? "Beleg"}${doc.invoiceNumber ? ` · ${doc.invoiceNumber}` : ""}`,
    sourceType: "freigabe",
    sourceId: doc.id,
    lines: vorsteuerAusgleichPosting(
      anteile.map((a) => ({ rate: a.rate, base: -a.base, tax: -a.tax })),
      books.kontenrahmen,
    ),
  });
  return true;
}
