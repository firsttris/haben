import {
  AUFLADUNG,
  aufladungFehler,
  aufladungPosting,
  kategorieFehler,
  kategoriePosting,
  kategorieText,
  type Cents,
  type DirektKategorie,
  type KategorieAngabe,
  type Kontenrahmen,
  type PostingLine,
  inBasisPoints,
} from "@haben/core";
import { z } from "zod";
import { UserError } from "../../errors.ts";
import type { Tx } from "../../db/index.ts";
import { kleinunternehmerForMonth } from "../stammdaten/index.ts";

/*
 * „Direkt buchen“ auf eine Einnahme- oder Ausgabekategorie mit Steuersatz (Roadmap Platz 1, #324): Kontierung und Buchung
 * aus packages/core/src/direkt-kategorie.ts, hier dazu der Kleinunternehmer-Stand im Monat der Zahlung.
 */

export class KategorieError extends UserError {}

/** Welche Kategorien es gibt, prüft kategorieFehler; die Ausgabekategorien wachsen, gebuchte bleiben gültig */
export const kategorieAngabeSchema = z.object({
  kategorie: z.string().min(1).max(40),
  steuersatz: inBasisPoints(z.number().int().min(0).max(10_000)),
});

export interface Kategoriebuchung {
  lines: PostingLine[];
  description: string;
  target: { category: DirektKategorie; taxRate: number };
}

/** Buchung eines Teils eines Umsatzes auf eine Kategorie; lehnt ab, was ohne Beleg nicht richtig zu buchen ist */
export async function kategoriebuchung(
  tx: Tx,
  kontenrahmen: Kontenrahmen,
  bank: { bookingDate: string; counterpartyName: string },
  eingabe: z.infer<typeof kategorieAngabeSchema>,
  amount: Cents,
): Promise<Kategoriebuchung> {
  const angabe = eingabe as KategorieAngabe;
  // Stand am Ende des Monats der Zahlung, wie die Voranmeldung ihn liest (computeVatFigures)
  const kleinunternehmer = await kleinunternehmerForMonth(Number(bank.bookingDate.slice(0, 4)), Number(bank.bookingDate.slice(5, 7)), tx);
  const fehler = kategorieFehler(angabe, kleinunternehmer);
  if (fehler) throw new KategorieError(fehler);
  return {
    lines: kategoriePosting(angabe, amount, kontenrahmen),
    description: `${bank.counterpartyName || "Bankumsatz"} · ${kategorieText(angabe)}`,
    target: { category: angabe.kategorie, taxRate: angabe.steuersatz },
  };
}

/**
 * Aufladung eines Guthabens (#1356): eine Zahlung ohne Beleg an einen Anbieter, bei dem das Geld als Guthaben liegt und
 * erst über eine spätere Rechnung verbraucht wird. Gebucht wie „Direkt buchen“ mit 0 %: Bank gegen das Konto der
 * Pflicht-Kostenkategorie, keine Vorsteuer, kein Beleg. Einen Steuersatz nimmt sie nicht an, auch keinen mitgegebenen:
 * Die Aufladung selbst trägt keine Umsatzsteuer (§ 3 Abs. 15 UStG), Vorsteuer entsteht erst mit der Rechnung über die
 * Leistung (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 2 UStG).
 */
export function aufladungBuchung(
  bank: { counterpartyName: string },
  eingabe: z.infer<typeof kategorieAngabeSchema>,
  amount: Cents,
  kontenrahmen: Kontenrahmen,
): Kategoriebuchung {
  // Ein mitgegebener Steuersatz wird abgelehnt, nicht still auf 0 gesetzt: Er wäre erfunden
  const angabe = eingabe as KategorieAngabe;
  const fehler = aufladungFehler(angabe);
  if (fehler) throw new KategorieError(fehler);
  return {
    lines: aufladungPosting(angabe, amount, kontenrahmen),
    // Die Aufladung steht vorn im Buchungstext: Daran erkennt der Archivabgleich ihre Zeile im DATEV-Stapel wieder,
    // auch wenn DATEV den Text auf 60 Zeichen kürzt (#1356)
    description: `${AUFLADUNG.text}: ${kategorieText(angabe)} · ${bank.counterpartyName || "Bankumsatz"}`,
    target: { category: angabe.kategorie, taxRate: 0 },
  };
}
