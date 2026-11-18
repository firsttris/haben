import type { JournalZeile } from "./journal-kennzahlen.ts";
import type { Cents } from "./money.ts";
import { ACCOUNTS, type Kontenrahmen } from "./posting.ts";

/*
 * Belegbuchungen mit § 13b oder innergemeinschaftlichem Erwerb aus Versionen vor #551 (bis v0.6) tragen die
 * Bemessungsgrundlage nicht so, wie die Voranmeldung sie meldet (#1396). Bemessungsgrundlage ist das Entgelt ohne die
 * Umsatzsteuer (§ 10 Abs. 1 Satz 1 und 2 UStG), bei § 13b auch für den privat bezogenen Teil (§ 13b Abs. 5 Satz 7 UStG):
 * - ohne Vorsteuerabzug stand die Steuer mit dem Netto in einer Aufwandszeile mit dem Steuerschlüssel (Kz 46 zu hoch);
 * - mit Privatanteil standen privates Netto und private Steuer zusammen ohne Steuerschlüssel auf den Entnahmen (Kz 46 zu
 *   niedrig).
 * Die Salden der Konten sind dieselben wie heute. Gebuchte Zeilen bleiben, wie sie sind (GoBD); beim Lesen bekommt die
 * erste Aufwandszeile je Steuerschlüssel die Bemessungsgrundlage (`basis`), die eine heutige Buchung trüge:
 * Aufwand mit Schlüssel + Entnahmen ohne Schlüssel − selbst geschuldete Steuer + Vorsteuer daraus. Heutige Buchungen erkennt
 * man an einer Zeile mit „keineVSt“ (Steuer ohne Abzug) oder einer Entnahme mit Steuerschlüssel (privates Netto); mit
 * vollem Vorsteuerabzug und ohne Privatanteil ist die Korrektur null. Den Privatanteil ordnet die Funktion nur zu, wenn die
 * Buchung genau einen dieser Steuerschlüssel trägt; Erwerb zu 19 % und 7 % mit Privatanteil auf einem Beleg bleibt, wie
 * gebucht.
 */

const SELBST_GESCHULDET: ReadonlySet<string> = new Set(["RC13bEU", "RC13bDrittland", "IGE19", "IGE7"]);

/** Die Zeilen einer Belegbuchung, bei einer Buchung von vor #551 mit der Bemessungsgrundlage wie heute */
export function mitBemessungWieHeute(kontenrahmen: Kontenrahmen, zeilen: readonly JournalZeile[]): JournalZeile[] {
  const a = ACCOUNTS[kontenrahmen];
  if (zeilen.some((z) => z.taxCode === "keineVSt" || (z.account === a.privatentnahmen && z.taxCode !== null))) return [...zeilen];
  const steuer = new Map<string, string | null>([
    [a.ustRc, null],
    [a.ustIge[1900], "IGE19"],
    [a.ustIge[700], "IGE7"],
  ]);
  const aufwand = new Map<string, number>();
  zeilen.forEach((z, i) => {
    if (z.taxCode && SELBST_GESCHULDET.has(z.taxCode) && !steuer.has(z.account) && z.account !== a.privatentnahmen && z.basis == null)
      if (!aufwand.has(z.taxCode)) aufwand.set(z.taxCode, i);
  });
  if (aufwand.size === 0) return [...zeilen];
  const rc = [...aufwand.keys()].find((c) => c.startsWith("RC13b")) ?? null;
  const vorsteuer = new Map<string, string | null>([
    [a.vorsteuerRc, rc],
    [a.vorsteuerIge[1900], "IGE19"],
    [a.vorsteuerIge[700], "IGE7"],
  ]);
  const korrektur = new Map<string, Cents>();
  const add = (code: string | null, betrag: Cents) => {
    if (code) korrektur.set(code, (korrektur.get(code) ?? 0) + betrag);
  };
  let privat = 0;
  for (const z of zeilen) {
    if (steuer.has(z.account)) add(steuer.get(z.account) ?? z.taxCode, -(z.credit - z.debit));
    else if (vorsteuer.has(z.account)) add(vorsteuer.get(z.account)!, z.debit - z.credit);
    else if (z.account === a.privatentnahmen) privat += z.debit - z.credit;
  }
  // Erwerb zu 19 % und 7 % mit Privatanteil: Das private Netto lässt sich keinem Satz centgenau zuordnen; ohne es wäre auch
  // der Abzug der Steuer falsch, also wie gebucht
  if (aufwand.size > 1 && privat !== 0) return [...zeilen];
  if (aufwand.size === 1) add([...aufwand.keys()][0]!, privat);
  return zeilen.map((z, i) => {
    for (const [code, index] of aufwand) {
      const k = korrektur.get(code) ?? 0;
      if (index === i && k !== 0) return { ...z, basis: z.debit - z.credit + k };
    }
    return z;
  });
}
