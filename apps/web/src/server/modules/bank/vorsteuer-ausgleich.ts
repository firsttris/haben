import { vorsteuerAusgleichPosting, type InvoiceTotals, type Kontenrahmen, type PostingLine, type TaxShare } from "@haben/core";
import type { Tx } from "../../db/index.ts";
import { ausfuehrungMitFreigabe, vorsteuerAnteile } from "../umsatzsteuer/index.ts";

/*
 * Vorsteuer, die beim Buchen auf dem Zwischenkonto steht (SKR03 1548, SKR04 1434): bei der Gutschrift, die bereits
 * Bezahltes erstattet (#786), und bei der Rechnung, deren Leistung beim Buchen noch nicht ausgeführt ist (#693). Erst der
 * Ausgleich — Bankerstattung, Zahlung, Verrechnung, Kursdifferenz — zieht den Anteil auf die Vorsteuer um (§ 15 Abs. 1
 * Satz 1 Nr. 1 UStG, § 17 Abs. 1 Satz 2 und 8 UStG), damit Kz 66 den Betrag genau dann sieht.
 *
 * Wie viel das ist, rechnet umsatzsteuer/vorsteuer-anteile.ts aus (dort steht auch, warum der Nachweis die Buchung ist
 * und was eine Kursdifferenz vor der Ausführung nicht zieht); hier wird nur gebucht.
 *
 * Bei Zuordnung, Ausbuchung und Kursdifferenz hängt die Umbuchung an der Buchung des Ausgleichs: Aufheben und Storno
 * drehen dann dieselben Zeilen mit um, ohne eigenen Weg und ohne Rückwirkung (reverseLines). Die Verrechnung bucht sonst
 * nichts und bekommt deshalb eine eigene Buchung, die ihre Gegenzeile mit umdreht.
 *
 * Ausgebuchtes Skonto zählt hier nicht mit: Es erstattet nichts, sondern erlässt den Rest. Seine Steuer wird deshalb
 * nicht gezogen, sondern vom Zwischenkonto abgeschrieben (documentWriteOffPosting mit der Angabe), sonst stünde die
 * Vorsteuer für Geld, das nie zurückkommt.
 */

/**
 * Zeilen der Umbuchung für einen Ausgleich dieses Belegs; leer, wenn seine Buchung nichts auf das Zwischenkonto gelegt
 * hat oder auf diesen Ausgleich kein Anteil entfällt.
 *
 * Liegt der Tag des Ausgleichs vor dem Rechnungsdatum, zieht er nichts: Abziehbar ist die Vorsteuer erst, wenn Rechnung
 * und Zahlung vorliegen (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 3 UStG, UStAE 15.3 Abs. 1 Satz 2; Befund der Selbstprüfung in
 * #930). Den Anteil gibt umsatzsteuer/vorsteuer-freigabe.ts mit eigener Freigabe zum Rechnungsdatum frei, damit er nicht
 * rückwirkend in einem Zeitraum steht, in dem die Rechnung noch nicht vorlag.
 */
export async function vorsteuerAusgleich(
  tx: Tx,
  doc: { id: string; privateShare: number; documentDate: string | null },
  totals: InvoiceTotals,
  amount: number,
  kontenrahmen: Kontenrahmen,
  datum: string,
  kursdifferenz = false,
): Promise<PostingLine[]> {
  // Vorkasse vor dem Rechnungsdatum: nichts umbuchen, sondern die Freigabe abwarten, die den Anteil zum Rechnungsdatum
  // zieht. Nur bei einem Beleg, der seine Vorsteuer über eine Freigabe führt; ohne sie (Jahr der Ausführung
  // abgeschlossen) bleibt es beim Ausgleich mit der Zahlung, sonst wäre die Steuer nirgends mehr abziehbar.
  if (doc.documentDate && datum < doc.documentDate && (await ausfuehrungMitFreigabe(tx, doc.id)) !== null) return [];
  const anteile = await vorsteuerAnteile(tx, doc, totals, amount, datum, kursdifferenz);
  return anteile === null ? [] : vorsteuerAusgleichPosting(anteile, kontenrahmen);
}

/**
 * Anteile einer Ausbuchung (Skonto) auf einen Beleg, dessen Vorsteuer noch auf dem Zwischenkonto steht, mit dem
 * Vorzeichen der Ausbuchung — also negativ, wo `vorsteuerAusgleich` positiv bucht. Was die Ausbuchung nicht mehr
 * erstattet, wird vom Zwischenkonto abgeschrieben statt auf die Vorsteuer gezogen; der Rest ist der Anteil am dann
 * Ausgeglichenen abzüglich dessen, was die bisherigen Ausgleiche schon umgebucht haben. `null`, wenn die Buchung des
 * Belegs nichts auf das Zwischenkonto gelegt hat: Dann bucht der Aufrufer wie bisher auf die Vorsteuer.
 */
export async function vorsteuerAbschreibung(
  tx: Tx,
  doc: { id: string; privateShare: number },
  totals: InvoiceTotals,
  amount: number,
  datum: string,
): Promise<TaxShare[] | null> {
  const anteile = await vorsteuerAnteile(tx, doc, totals, amount, datum);
  return anteile?.map((s) => ({ rate: s.rate, base: -s.base, tax: -s.tax })) ?? null;
}
