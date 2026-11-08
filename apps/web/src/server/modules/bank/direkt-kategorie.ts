import {
  kategorieFehler,
  kategoriePosting,
  kategorieText,
  type Cents,
  type DirektKategorie,
  type KategorieAngabe,
  type Kontenrahmen,
  type PostingLine,
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
  steuersatz: z.number().int().min(0).max(10_000),
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
