import { gemeldeterStand, monthsOfPeriod, zmEuro, type VatPeriod } from "@haben/core";
import { and, eq, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { computeVatFigures } from "./vat-figures.ts";
import { sentMeldungen } from "./zm.ts";

/*
 * Gesendete Zusammenfassende Meldung gegen Kz 21 und 41 aus dem Journal (#1116, Hinweis von Dudeplayz in #1144): Die ZM
 * rechnet aus den Rechnungen, die Voranmeldung aus dem Journal. Das BZSt gleicht beide ab (§ 18a, § 18b UStG); eine
 * innergemeinschaftliche Lieferung, die in der ZM nicht oder unrichtig steht, ist steuerpflichtig (Anleitung zur
 * Voranmeldung 2026, Zeile 19, mit UStAE 4.1.2 Abs. 2 und 3). Verglichen wird der Stand beim BZSt nach allen echt
 * übermittelten Meldungen des Quartals mit Kz 21 bzw. 41 des Quartals aus dem Journal, beides in vollen Euro. Wie in der
 * Vorprüfung der ZM (zmIssues) ist bis zu ein Euro je Zeile und Voranmeldung Rundung.
 */

export interface ZmAbweichung {
  period: VatPeriod;
  art: "S" | "L";
  /** Volle Euro */
  gemeldet: number;
  journal: number;
}

const KENNZAHL = { S: "kz21", L: "kz41" } as const;

/** Quartal (41–44), in dem ein Monat bzw. Quartal der Voranmeldung liegt */
export const quartalVon = (period: VatPeriod): VatPeriod => (period.month > 12 ? period : { year: period.year, month: 40 + Math.ceil(period.month / 3) });

/** Abweichungen der gesendeten ZM eines Quartals von Kz 21 und 41 aus dem Journal; leer ohne gesendete Meldung */
export async function zmAbweichungen(quartal: VatPeriod, q: Db | Tx = db): Promise<ZmAbweichung[]> {
  const meldungen = await sentMeldungen(quartal, q);
  if (meldungen.length === 0) return [];
  const stand = gemeldeterStand(meldungen);
  const figures = await computeVatFigures(quartal, q);
  const voranmeldungen = monthsOfPeriod(quartal).length;
  const result: ZmAbweichung[] = [];
  for (const art of ["S", "L"] as const) {
    const zeilen = stand.filter((z) => z.art === art);
    const gemeldet = zeilen.reduce((s, z) => s + zmEuro(z.betrag), 0);
    const journal = zmEuro(figures[KENNZAHL[art]]);
    if (Math.abs(gemeldet - journal) > zeilen.length + voranmeldungen) result.push({ period: quartal, art, gemeldet, journal });
  }
  return result;
}

/** Wie zmAbweichungen für alle Quartale eines Jahres mit gesendeter ZM */
export async function zmAbweichungenImJahr(year: number, q: Db | Tx = db): Promise<ZmAbweichung[]> {
  const z = schema.zmSubmissions;
  const quartale = await q
    .selectDistinct({ month: z.month })
    .from(z)
    .where(and(eq(z.year, year), eq(z.kind, "send"), eq(z.ok, true), sql`${z.month} > 40`))
    .orderBy(z.month);
  const result: ZmAbweichung[] = [];
  for (const { month } of quartale) result.push(...(await zmAbweichungen({ year, month }, q)));
  return result;
}

export const ZM_POSTEN: Record<ZmAbweichung["art"], string> = {
  S: "Gesendete ZM, sonstige Leistungen gegen Kz 21",
  L: "Gesendete ZM, innergemeinschaftliche Lieferungen gegen Kz 41",
};
