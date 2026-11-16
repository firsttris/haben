import { kennzahlenAusJournal, type JournalKennzahl, type JournalZeile } from "./journal-kennzahlen.ts";
import type { BasisPoints, Cents } from "./money.ts";
import { ACCOUNTS, type Kontenrahmen, type Versteuerung } from "./posting.ts";

/*
 * Umsatzsteuer-Verprobung im Journal (#1116): Je Buchung muss die Steuer auf den Steuerkonten zur Bemessungsgrundlage aus
 * Konto und Steuerschlüssel passen (Bemessungsgrundlage mal Steuersatz). Sie ersetzt die Gegenprobe aus den Nebenbüchern:
 * Statt zweimal zu rechnen, prüft sie, ob das Journal in sich stimmt. Weil je Beleg gerundet wird (Steuer je Satz der
 * Rechnung, Anteil einer Teilzahlung), gilt eine Toleranz von einem Cent je Satz der Buchung: Den Anteil einer Zahlung an
 * jedem Satz rundet paidTaxShares einzeln und schlägt den Rest aller Sätze dem größten zu, so dass alle Zahlungen zusammen
 * genau die Steuer der Rechnung ergeben. Steuersätze nach § 12 Abs. 1 und 2 UStG; bei Ist entsteht die Steuer mit der
 * Vereinnahmung (§ 13 Abs. 1 Nr. 1 Buchst. b UStG).
 *
 * Geprüft wird, wo Steuerschlüssel und Steuerkonto den Satz eindeutig nennen: Umsatzsteuer 19 % und 7 % (Kz 81/86, bei Ist
 * erst mit der Zahlung wie kennzahlenAusJournal), Erwerbsteuer (Kz 89/93) und die Vorsteuer 19 % und 7 % (VSt19, VSt7 auf der
 * Aufwandszeile gegen das Vorsteuerkonto des Satzes). Nicht geprüft: § 13b (der Schlüssel nennt keinen Satz), die
 * Einfuhrumsatzsteuer (der Bescheid nennt die Steuer, keine Bemessungsgrundlage) und Buchungen über das Zwischenkonto der
 * noch nicht abziehbaren Vorsteuer (Gutschrift, die bereits Bezahltes erstattet, #786; Leistung nach dem Belegdatum, #930).
 * Bei anteiligem Vorsteuerabzug (§ 15 Abs. 4 UStG, #926) steht der nicht abziehbare Teil mit „keineVSt“ auf dem Aufwand,
 * ohne Satz; dann darf die Vorsteuer je Satz nur nicht höher sein als Bemessungsgrundlage mal Satz. Denselben Schlüssel trägt
 * eine Position zu 0 % (inputTaxCode(0)). Als anteilig gilt eine Buchung deshalb nur, wenn „keineVSt“-Zeilen die Lücke
 * zwischen voller und gebuchter Vorsteuer genau füllen (#1230); sonst fiele zu wenig Vorsteuer neben einer 0-%-Position
 * nicht auf.
 */

export interface VerprobungsAbweichung {
  /** Satz in Basispunkten */
  satz: 1900 | 700;
  art: "umsatzsteuer" | "erwerbsteuer" | "vorsteuer";
  bemessung: Cents;
  /** Steuer auf den Steuerkonten */
  steuer: Cents;
  /** Bemessungsgrundlage mal Satz, kaufmännisch gerundet */
  erwartet: Cents;
}

/** Toleranz je Satz der Buchung: Rundung je Beleg */
export const VERPROBUNG_TOLERANZ = 1;

/** Toleranz für eine Gruppe (Umsatz-, Erwerb- oder Vorsteuer): ein Cent je Satz, der in der Buchung vorkommt */
const toleranz = (saetze: { bemessung: Cents; steuer: Cents }[]) =>
  VERPROBUNG_TOLERANZ * Math.max(1, saetze.filter((x) => x.bemessung !== 0 || x.steuer !== 0).length);

const steuerZu = (bemessung: Cents, satz: BasisPoints) => Math.round((bemessung * satz) / 10_000);

const PAARE: { art: VerprobungsAbweichung["art"]; satz: 1900 | 700; bemessung: JournalKennzahl; steuer: JournalKennzahl }[] = [
  { art: "umsatzsteuer", satz: 1900, bemessung: "kz81", steuer: "tax81" },
  { art: "umsatzsteuer", satz: 700, bemessung: "kz86", steuer: "tax86" },
  { art: "erwerbsteuer", satz: 1900, bemessung: "kz89", steuer: "tax89" },
  { art: "erwerbsteuer", satz: 700, bemessung: "kz93", steuer: "tax93" },
];

/** Was an einer Buchung nicht zur Bemessungsgrundlage passt; leer, wenn alles stimmt */
export function verprobeBuchung(kontenrahmen: Kontenrahmen, versteuerung: Versteuerung, zeilen: readonly JournalZeile[]): VerprobungsAbweichung[] {
  const k = kennzahlenAusJournal(kontenrahmen, versteuerung, [zeilen]);
  const result: VerprobungsAbweichung[] = [];
  for (const { art, satz, bemessung, steuer } of PAARE) {
    const erwartet = steuerZu(k[bemessung], satz);
    const erlaubt = toleranz(PAARE.filter((p) => p.art === art).map((p) => ({ bemessung: k[p.bemessung], steuer: k[p.steuer] })));
    if (Math.abs(k[steuer] - erwartet) > erlaubt) result.push({ satz, art, bemessung: k[bemessung], steuer: k[steuer], erwartet });
  }
  const a = ACCOUNTS[kontenrahmen];
  // Gutschrift, die bereits Bezahltes erstattet (#786): Die Vorsteuer steht bis zum Ausgleich auf dem Zwischenkonto, die
  // Umbuchung danach trägt keine Bemessungsgrundlage; beide Buchungen prüft die Verprobung nicht
  if (zeilen.some((z) => z.account === a.vorsteuerNochNichtAbziehbar)) return result;
  const steuerkonten = new Set<string>(Object.values(a.vorsteuer));
  const vorsteuer = ([1900, 700] as const).map((satz) => {
    const code = satz === 1900 ? "VSt19" : "VSt7";
    // Die Vorsteuerzeile trägt den Schlüssel auch; Bemessungsgrundlage ist die Aufwandszeile
    const bemessung = zeilen.filter((z) => z.taxCode === code && !steuerkonten.has(z.account)).reduce((s, z) => s + (z.basis ?? z.debit - z.credit), 0);
    const steuer = zeilen.filter((z) => z.account === a.vorsteuer[satz]).reduce((s, z) => s + z.debit - z.credit, 0);
    return { satz, bemessung, steuer, erwartet: steuerZu(bemessung, satz) };
  });
  const erlaubt = toleranz(vorsteuer);
  // Nicht abziehbare Anteile oder Positionen ohne Vorsteuer, mit Vorzeichen wie die Vorsteuer (eine Gutschrift dreht beide)
  const ohneAbzug = zeilen.filter((z) => z.taxCode === "keineVSt" && !steuerkonten.has(z.account)).map((z) => z.debit - z.credit);
  const luecke = vorsteuer.reduce((s, v) => s + v.erwartet - v.steuer, 0);
  const anteilig = ohneAbzug.length > 0 && fuelltLuecke(ohneAbzug, luecke, erlaubt);
  for (const v of vorsteuer) {
    // Anteilig: dem Betrag nach höchstens die volle Steuer, mit gleichem Vorzeichen (eine Gutschrift dreht beide)
    const zuViel = Math.abs(v.steuer) - Math.abs(v.erwartet) > erlaubt || v.steuer * v.erwartet < 0;
    if (anteilig ? zuViel : Math.abs(v.steuer - v.erwartet) > erlaubt) result.push({ ...v, art: "vorsteuer" });
  }
  return result;
}

/** Höchstens so viele Teilsummen; darüber gilt die Lücke als gefüllt (wie vor #1230), statt lange zu rechnen */
const MAX_TEILSUMMEN = 4096;

/**
 * Ergeben einige der Beträge zusammen die Lücke, bis auf `toleranz`? Beim anteiligen Abzug ist jeder nicht abziehbare Anteil
 * eine eigene Zeile, daneben können Positionen zu 0 % stehen; deshalb jede Auswahl, nicht nur die Summe aller.
 */
function fuelltLuecke(betraege: readonly Cents[], luecke: Cents, toleranz: Cents): boolean {
  let summen = new Set<number>([0]);
  for (const betrag of betraege) {
    summen = new Set([...summen, ...[...summen].map((s) => s + betrag)]);
    if (summen.size > MAX_TEILSUMMEN) return true;
  }
  return [...summen].some((s) => s !== 0 && Math.abs(s - luecke) <= toleranz);
}
