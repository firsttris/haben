import type { BasisPoints, Cents } from "../money.ts";
import type { SvJahreswerte } from "./werte.ts";

/**
 * Rechenschritte mit ganzen Zahlen (`bigint`), ohne Gleitkomma. Gerundet wird nur das Ergebnis, kaufmännisch auf
 * ganze Cent: § 1 Abs. 2 BVV (Rechengänge ohne Rundung der Zwischenergebnisse, Ergebnis auf zwei Dezimalstellen),
 * „die zweite Dezimalstelle ist um 1 zu erhöhen, wenn sich in der dritten Dezimalstelle eine der Zahlen 5 bis 9
 * ergeben würde“ (Gemeinsames Rundschreiben der Spitzenverbände zum Übergangsbereich).
 */

/** zaehler / nenner für nicht negative Werte, kaufmännisch auf eine ganze Zahl gerundet */
function rundeBruch(zaehler: bigint, nenner: bigint): number {
  return Number((2n * zaehler + nenner) / (2n * nenner));
}

/** Beitrag auf `basis` zum Satz `satz` / `teiler`; `teiler` 2 ergibt den halben Satz */
export function beitrag(basis: Cents, satz: BasisPoints, teiler = 1): Cents {
  return rundeBruch(BigInt(basis) * BigInt(satz), 10_000n * BigInt(teiler));
}

/**
 * Beitrag, den Arbeitgeber und Beschäftigter je zur Hälfte tragen: halber Satz auf das Entgelt, gerundet, die
 * Hälfte trägt jeder (§ 2 Abs. 1 Satz 1 BVV: „Anwendung des halben Beitragssatzes … und anschließender
 * Verdoppelung des gerundeten Ergebnisses“).
 */
export function haelftig(basis: Cents, satz: BasisPoints): { an: Cents; ag: Cents } {
  const haelfte = beitrag(basis, satz, 2);
  return { an: haelfte, ag: haelfte };
}

/**
 * Beitragspflichtige Einnahme im Übergangsbereich für den Gesamtbeitrag, § 20 Abs. 2a Satz 1 SGB IV:
 * F × G + ([OG / (OG − G)] − [G / (OG − G)] × F) × (AE − G), G Geringfügigkeitsgrenze, OG obere Grenze, AE Entgelt.
 * Auf einen Nenner gebracht und erst am Ende auf Cent gerundet; F wie bekannt gemacht mit vier Dezimalstellen.
 */
export function uebergangGesamt(entgelt: Cents, w: SvJahreswerte): Cents {
  const [ae, g, og, f] = [entgelt, w.geringfuegigkeitsgrenze, w.uebergangsbereichBis, w.faktorF].map(BigInt) as [bigint, bigint, bigint, bigint];
  const zaehler = f * g * (og - g) + (10_000n * og - g * f) * (ae - g);
  return rundeBruch(zaehler, 10_000n * (og - g));
}

/** Beitragspflichtige Einnahme im Übergangsbereich für den Anteil des Beschäftigten: OG / (OG − G) × (AE − G) */
export function uebergangArbeitnehmer(entgelt: Cents, w: SvJahreswerte): Cents {
  const [ae, g, og] = [entgelt, w.geringfuegigkeitsgrenze, w.uebergangsbereichBis].map(BigInt) as [bigint, bigint, bigint];
  return rundeBruch(og * (ae - g), og - g);
}
