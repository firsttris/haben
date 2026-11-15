import { kennzahlenAusJournal, type JournalKennzahl, type JournalZeile } from "./journal-kennzahlen.ts";
import type { Cents } from "./money.ts";
import { ACCOUNTS, type Kontenrahmen, type Versteuerung } from "./posting.ts";

/*
 * Umsatzsteuer-Verprobung im Journal (#1116): Je Buchung muss die Steuer auf den Steuerkonten zur Bemessungsgrundlage aus
 * Konto und Steuerschlüssel passen (Bemessungsgrundlage mal Steuersatz). Sie ersetzt die Gegenprobe aus den Nebenbüchern:
 * Statt zweimal zu rechnen, prüft sie, ob das Journal in sich stimmt. Weil je Beleg gerundet wird (Steuer je Satz der
 * Rechnung, Anteil einer Teilzahlung), gilt je Buchung und Satz eine Toleranz von einem Cent.
 *
 * Geprüft wird, wo Steuerschlüssel und Steuerkonto den Satz eindeutig nennen: Umsatzsteuer 19 % und 7 % (Kz 81/86, bei Ist
 * erst mit der Zahlung wie kennzahlenAusJournal), Erwerbsteuer (Kz 89/93) und die Vorsteuer 19 % und 7 % (VSt19, VSt7 auf der
 * Aufwandszeile gegen das Vorsteuerkonto des Satzes). Nicht geprüft: § 13b (der Schlüssel nennt keinen Satz) und die
 * Einfuhrumsatzsteuer (der Bescheid nennt die Steuer, keine Bemessungsgrundlage), die Vorsteuer einer Gutschrift, die bereits
 * Bezahltes erstattet (Zwischenkonto, #786).
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

/** Toleranz je Buchung und Satz: Rundung je Beleg */
export const VERPROBUNG_TOLERANZ = 1;

const steuerZu = (bemessung: Cents, satz: number) => Math.round((bemessung * satz) / 10_000);

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
    if (Math.abs(k[steuer] - erwartet) > VERPROBUNG_TOLERANZ) result.push({ satz, art, bemessung: k[bemessung], steuer: k[steuer], erwartet });
  }
  const a = ACCOUNTS[kontenrahmen];
  // Gutschrift, die bereits Bezahltes erstattet (#786): Die Vorsteuer steht bis zum Ausgleich auf dem Zwischenkonto, die
  // Umbuchung danach trägt keine Bemessungsgrundlage; beide Buchungen prüft die Verprobung nicht
  if (zeilen.some((z) => z.account === a.vorsteuerNochNichtAbziehbar)) return result;
  const steuerkonten = new Set<string>(Object.values(a.vorsteuer));
  for (const satz of [1900, 700] as const) {
    const code = satz === 1900 ? "VSt19" : "VSt7";
    // Die Vorsteuerzeile trägt den Schlüssel auch; Bemessungsgrundlage ist die Aufwandszeile
    const bemessung = zeilen.filter((z) => z.taxCode === code && !steuerkonten.has(z.account)).reduce((s, z) => s + (z.basis ?? z.debit - z.credit), 0);
    const steuer = zeilen.filter((z) => z.account === a.vorsteuer[satz]).reduce((s, z) => s + z.debit - z.credit, 0);
    const erwartet = steuerZu(bemessung, satz);
    if (Math.abs(steuer - erwartet) > VERPROBUNG_TOLERANZ) result.push({ satz, art: "vorsteuer", bemessung, steuer, erwartet });
  }
  return result;
}
