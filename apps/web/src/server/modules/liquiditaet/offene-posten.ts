import { addDays, naechsterWerktag, postenAus, roundHalfAwayFromZero, type LiquiditaetsPosten } from "@haben/core";
import { inArray } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { openPositions, type OpenPosition } from "../auswertungen/index.ts";
import type { Kontext } from "./kontext.ts";

/*
 * Offene Posten wie unter Auswertungen › Offene Posten (`openPositions`): Forderungen aus festgeschriebenen Rechnungen
 * (erwartet zur Fälligkeit), Verbindlichkeiten aus gebuchten Belegen mit Zahlung „Bank“ (fest) und Zahllast bzw.
 * Erstattung abgegebener Voranmeldungen (Zahllast fest, Erstattung erwartet: wann sie kommt, entscheidet das Finanzamt).
 */

const text = (p: OpenPosition) => [p.number, p.party].filter(Boolean).join(" · ");

/**
 * Umsatzsteuer im offenen Betrag einer Rechnung, anteilig wie bei einer Teilzahlung. Nur bei Istversteuerung entsteht sie
 * erst mit dem Zahlungseingang (§ 13 Abs. 1 Nr. 1 Buchst. b UStG); bei Sollversteuerung ist sie mit der Rechnung schon
 * gebucht und steckt in der Voranmeldung.
 */
async function steuerJeRechnung(ids: string[]): Promise<Map<string, { tax: number; gross: number }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.invoices.id, tax: schema.invoices.tax, gross: schema.invoices.gross })
    .from(schema.invoices)
    .where(inArray(schema.invoices.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Forderungen: zur Fälligkeit erwartet. Überfällige stehen nach dem Vorschlag in #1381 (bis #1384 das Zahlungsverhalten
 * je Kunde kennt) am nächsten Werktag als geschätzt; `ueberfaellige: false` lässt sie weg.
 */
async function forderungen(k: Kontext, receivables: OpenPosition[], ueberfaellige: boolean): Promise<LiquiditaetsPosten[]> {
  const steuern = await steuerJeRechnung(receivables.map((r) => r.id));
  const naechsterTag = naechsterWerktag(addDays(k.heute, 1), k.bundesland);
  return receivables.flatMap((r) => {
    const ueberfaellig = r.dueDate < k.heute;
    // Weggelassen werden nur Eingänge: eine Erstattung an den Kunden (Storno einer bezahlten Rechnung) bleibt zu zahlen
    if (ueberfaellig && !ueberfaellige && r.open > 0) return [];
    const datum = ueberfaellig ? naechsterTag : r.dueDate;
    const rechnung = steuern.get(r.id);
    const steuer =
      rechnung && rechnung.gross !== 0 && k.versteuerung(datum) === "ist" && !k.kleinunternehmer(datum)
        ? roundHalfAwayFromZero((r.open * rechnung.tax) / rechnung.gross)
        : 0;
    return postenAus(r.open, {
      datum,
      text: text(r),
      quelle: { art: "rechnung", id: r.id },
      sicherheit: ueberfaellig ? "geschaetzt" : "erwartet",
      ...(ueberfaellig ? { ueberfaellig: true } : {}),
      ...(steuer !== 0 ? { steuer: { betrag: steuer, datum } } : {}),
    });
  });
}

/** Offene Posten als Posten der Vorschau; Überfälliges außer Forderungen rückt der Kern auf heute */
export async function offenePostenPosten(k: Kontext, { ueberfaellige }: { ueberfaellige: boolean }): Promise<LiquiditaetsPosten[]> {
  const { receivables, advanceRequests, advanceRefunds, payables, vat } = await openPositions(k.heute);
  const verbindlichkeiten = payables.flatMap((p) =>
    // Als Verbindlichkeit positiv: geht ab
    postenAus(-p.open, { datum: p.dueDate, text: text(p), quelle: { art: "beleg", id: p.id }, sicherheit: "fest" }),
  );
  const voranmeldungen = vat.flatMap((v) =>
    // Zahllast positiv, Erstattung negativ
    postenAus(-v.open, {
      datum: v.dueDate,
      text: `Umsatzsteuer ${v.number}`,
      quelle: { art: "voranmeldung", id: v.id },
      sicherheit: v.open > 0 ? "fest" : "erwartet",
    }),
  );
  // Im neuen Anzahlungsverfahren der GmbH stehen Rechnungen vor der Leistung als Anforderung und Erstattungen von
  // Anzahlungen getrennt (`advanceOpenPositions`); gezahlt wird beides wie eine Forderung
  const forderungsListe = [...receivables, ...advanceRequests, ...advanceRefunds];
  return [...(await forderungen(k, forderungsListe, ueberfaellige)), ...verbindlichkeiten, ...voranmeldungen];
}
