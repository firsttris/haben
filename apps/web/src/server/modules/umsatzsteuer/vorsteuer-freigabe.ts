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
 * Die vorausdatierte Freigabe steht ab dem Buchen im Journal, die Zahlung kommt später. Sie lässt sich deshalb nicht
 * beim Buchen entscheiden, sondern wird beim Ereignis nachgezogen (#930, Entscheidung des Maintainers): Eine Zahlung vor
 * der Ausführung hebt die Freigabe zum Ausführungsdatum auf, gibt ihren Anteil an ihrem eigenen Tag frei und schreibt
 * den Rest wieder zum Ausführungsdatum fest. Dasselbe gilt für die Aufhebung einer Zahlung. So bleibt der Monat der
 * Ausführung bei der Steuer, die erst dann abziehbar wird, und das Zwischenkonto steht am Ende auf null.
 *
 * Nicht hierher gehören Gutschriften, die bereits Bezahltes erstatten (#786, § 17 Abs. 1 UStG): Ihre Minderung hängt am
 * Ausgleich, nicht an der Ausführung. § 13b, innergemeinschaftlicher Erwerb und Einfuhrumsatzsteuer haben ihren eigenen
 * Zeitpunkt; `leistungNochNichtAusgefuehrt` in belegbuchung.ts lässt sie deshalb schon nicht auf das Zwischenkonto.
 */

/** Trägt der Beleg schon eine Freigabe (auch eine aufgehobene)? */
export async function hatFreigabe(tx: Tx, documentId: string): Promise<boolean> {
  const [schon] = await tx
    .select({ id: schema.journalEntries.id })
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.sourceType, "freigabe"), eq(schema.journalEntries.sourceId, documentId)));
  return schon !== undefined;
}

/** Trägt der Beleg schon eine wirksame Freigabe (ein Storno zählt nicht)? */
export async function schonFreigegeben(tx: Tx, documentId: string): Promise<boolean> {
  const [schon] = await tx
    .select({ id: schema.journalEntries.id })
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.sourceType, "freigabe"), eq(schema.journalEntries.sourceId, documentId), isNull(schema.journalEntries.reversesId)));
  return schon !== undefined;
}

/** Freigaben des Belegs, die noch stehen: nicht storniert und ohne Gegenbuchung */
async function offeneFreigaben(tx: Tx, documentId: string) {
  return await tx
    .select({
      id: schema.journalEntries.id,
      date: schema.journalEntries.date,
      description: schema.journalEntries.description,
      kontenrahmen: schema.journalEntries.kontenrahmen,
    })
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.sourceType, "freigabe"),
        eq(schema.journalEntries.sourceId, documentId),
        isNull(schema.journalEntries.reversesId),
        sql`not exists (select 1 from journal_entries r where r.reverses_id = ${schema.journalEntries.id})`,
      ),
    );
}

/** Beide Konten dieses Zwischenkontos, damit ein Wechsel des Kontenrahmens die Buchung nicht verliert */
const ZWISCHENKONTEN = [ACCOUNTS.SKR03.vorsteuerNochNichtAbziehbar, ACCOUNTS.SKR04.vorsteuerNochNichtAbziehbar];

/** Steuersatz zum Steuerschlüssel; das Zwischenkonto trägt 19 % und 7 % */
function satzZumSchluessel(code: string | null): number | null {
  if (code === "VSt19") return 1900;
  if (code === "VSt7") return 700;
  return null;
}

/**
 * Was zu diesem Beleg noch auf dem Zwischenkonto steht, je Steuersatz, mit dem Vorzeichen der Buchung: bei einer
 * Rechnung positiv (Soll), bei einer Gutschrift negativ. Gelesen wird das ganze Journal des Belegs — Buchung,
 * Zuordnungen, Verrechnungen, Ausbuchungen samt Skonto und die Freigaben selbst. Der Saldo ist die Wahrheit über das, was noch
 * wartet; er stimmt auch nach einer Aufhebung oder einem Wechsel des Kontenrahmens.
 */
async function zwischenkontoSaldo(tx: Tx, documentId: string): Promise<TaxShare[]> {
  const rows = await tx.execute<{ tax_code: string | null; bewegt: number; basis: number }>(sql`
    select l.tax_code,
           sum(l.debit - l.credit)::int as bewegt,
           sum(case when l.debit <> 0 then coalesce(l.basis, 0) else -coalesce(l.basis, 0) end)::int as basis
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
     where (l.account = ${ZWISCHENKONTEN[0]!} or l.account = ${ZWISCHENKONTEN[1]!})
       and ((e.source_type = 'document' and e.source_id = ${documentId})
         or (e.source_type = 'allocation' and e.source_id in (select id from allocations where document_id = ${documentId}))
         or (e.source_type = 'freigabe' and e.source_id = ${documentId})
         or (e.source_type = 'verrechnung' and e.source_id in (select id from document_settlements where document_id = ${documentId}))
         -- Auch Skonto: Es schreibt seinen Anteil vom Zwischenkonto ab, und die Freigabe darf ihn nicht noch einmal ziehen
         or (e.source_type = 'ausbuchung' and e.source_id in (select id from write_offs where document_id = ${documentId})))
     group by l.tax_code`);
  return [...rows].flatMap((r) => {
    const rate = satzZumSchluessel(r.tax_code);
    const tax = Number(r.bewegt);
    return rate === null || tax === 0 ? [] : [{ rate, base: Number(r.basis), tax }];
  });
}

/** Dreht eine einzelne Freigabe mit ihren Zeilen um, am übergebenen Tag */
async function freigabeUmkehren(
  tx: Tx,
  books: Books,
  documentId: string,
  freigabe: { id: string; description: string | null; date: string },
  am: string,
): Promise<void> {
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
    date: am,
    description: `Storno: ${freigabe.description ?? "Vorsteuer aus Leistungszeitraum"}`,
    sourceType: "freigabe",
    sourceId: documentId,
    reversesId: freigabe.id,
    lines: zeilen.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit, taxCode: l.taxCode as TaxCode | null, basis: l.basis })),
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
): Promise<string | null> {
  if (!doc.documentDate) return null;
  const am = leistungsdatum({ belegdatum: doc.documentDate, leistungVon: doc.serviceFrom, leistungBis: doc.serviceTo });
  // Nur ein Zeitraum nach dem Belegdatum parkt überhaupt; sonst gilt der Belegmonat
  if (am <= doc.documentDate) return null;

  const anteile = await zwischenkontoSaldo(tx, doc.id);
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
 * Dreht die Freigaben beim Storno eines Belegs zurück. Am Tag des Stornos, aber nie vor der Freigabe selbst: Eine
 * Freigabe, die erst mit der Ausführung fällig wäre, wird in ihrem eigenen Monat aufgehoben, damit dort keine Minderung
 * ohne Gegenstück entsteht.
 */
export async function freigabeStornieren(tx: Tx, books: Books, documentId: string, stornoAm: string): Promise<number> {
  let anzahl = 0;
  for (const freigabe of await offeneFreigaben(tx, documentId)) {
    await freigabeUmkehren(tx, books, documentId, freigabe, freigabe.date > stornoAm ? freigabe.date : stornoAm);
    anzahl += 1;
  }
  return anzahl;
}

/**
 * Zieht die Freigabe nach einer Zahlung oder deren Aufhebung nach (#930, Entscheidung des Maintainers): Eine Zahlung vor
 * der Ausführung nimmt die vorausdatierte Freigabe zurück, gibt ihren Anteil an ihrem eigenen Tag frei (das bucht
 * vorsteuer-ausgleich.ts in der Zeile der Zuordnung) und schreibt den Rest wieder zum Ausführungsdatum fest. Kein Lauf im
 * Scheduler: die Voranmeldung soll nicht davon abhängen, wann er gelaufen ist.
 *
 * Hat sich am Stand nichts geändert — etwa eine Zahlung nach der Ausführung —, bleibt die Freigabe stehen und es
 * entstehen keine Buchungen. Ohne Freigabe (Gutschrift „erstattet bereits Bezahltes“, abgeschlossenes Jahr) passiert
 * nichts; dann bleibt es beim Ausgleich mit der Zahlung.
 *
 * `datum` ist der Tag des Ereignisses (Zahlung, Aufhebung, Verrechnung, Ausbuchung). Liegt er an oder nach der
 * Ausführung, ist die Vorsteuer mit Leistung und Rechnung abziehbar und das Ereignis ändert daran nichts mehr: Was es
 * auf das Zwischenkonto zurücklegt, wird am selben Tag wieder frei. Der Monat der Ausführung bleibt unberührt, er kann
 * schon gemeldet sein.
 */
export async function freigabeNachziehen(tx: Tx, documentId: string, books: Books, datum: string): Promise<boolean> {
  const [doc] = await tx.select().from(schema.documents).where(eq(schema.documents.id, documentId));
  if (!doc?.documentDate) return false;
  const am = leistungsdatum({ belegdatum: doc.documentDate, leistungVon: doc.serviceFrom, leistungBis: doc.serviceTo });
  if (am <= doc.documentDate) return false;
  // Nur Belege mit Freigabe zum Leistungsdatum; die Gutschrift nach § 17 Abs. 1 UStG hat keine
  if (!(await hatFreigabe(tx, doc.id))) return false;

  // Was gerade noch auf dem Zwischenkonto steht. Null heißt: Die Freigabe zum Ausführungsdatum deckt den Rest schon
  // genau — nach der Ausführung gezahlt ändert sich nichts, und es entstehen keine Buchungen ohne Anlass.
  const stand = await zwischenkontoSaldo(tx, doc.id);
  if (stand.length === 0) return true;

  // Nach der Ausführung: den zurückgelegten Stand am Tag des Ereignisses freigeben, nichts rückwirkend
  if (datum >= am) {
    await post(tx, books, {
      date: datum,
      description: `Vorsteuer aus Leistungszeitraum: ${doc.supplierName ?? "Beleg"}${doc.invoiceNumber ? ` · ${doc.invoiceNumber}` : ""}`,
      sourceType: "freigabe",
      sourceId: doc.id,
      lines: vorsteuerAusgleichPosting(
        stand.map((a) => ({ rate: a.rate, base: -a.base, tax: -a.tax })),
        books.kontenrahmen,
      ),
    });
    return true;
  }

  // 1. Die Freigaben zum Ausführungsdatum zurücknehmen, in ihrem eigenen Monat: Sie deckten den Stand von vor diesem
  //    Ereignis. Rückwirkend gemindert wird dabei nichts — Aufhebung und neue Freigabe stehen am selben Tag.
  for (const freigabe of await offeneFreigaben(tx, doc.id)) await freigabeUmkehren(tx, books, doc.id, freigabe, freigabe.date);

  // 2. Was jetzt wartet, wieder zum Ausführungsdatum freigeben
  const rest = await zwischenkontoSaldo(tx, doc.id);
  if (rest.length === 0) return true;
  const [geschlossen] = await tx
    .select({ year: schema.yearClosings.year })
    .from(schema.yearClosings)
    .where(eq(schema.yearClosings.year, Number(am.slice(0, 4))));
  if (geschlossen) return true;

  await post(tx, books, {
    date: am,
    description: `Vorsteuer aus Leistungszeitraum: ${doc.supplierName ?? "Beleg"}${doc.invoiceNumber ? ` · ${doc.invoiceNumber}` : ""}`,
    sourceType: "freigabe",
    sourceId: doc.id,
    lines: vorsteuerAusgleichPosting(
      rest.map((a) => ({ rate: a.rate, base: -a.base, tax: -a.tax })),
      books.kontenrahmen,
    ),
  });
  return true;
}
