import type { JournalZeile } from "./journal-kennzahlen.ts";
import { splitPrivateShare, type Cents, type Prozent } from "./money.ts";
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
 * vollem Vorsteuerabzug und ohne Privatanteil ist die Korrektur null. Trägt die Buchung genau einen dieser Steuerschlüssel,
 * gehört der private Teil zu ihm. Beim Erwerb zu 19 % und 7 % mit Privatanteil auf einem Beleg steht er in einer Summe auf
 * den Entnahmen; aufteilen lässt er sich nur mit dem Beleg (privatJeErwerbssatz, wie documentRatePosting heute je Satz).
 * Ohne diese Aufteilung, oder wenn sie nicht zum gebuchten Teil passt, bleibt die Buchung, wie gebucht. Der Aufrufer wendet
 * die Funktion nur auf Belegbuchungen an, die vor dem Update auf das Journal angelegt wurden (belegAusAlterVersion in
 * apps/web); die Form allein unterscheidet keine Versionen.
 */

const SELBST_GESCHULDET: ReadonlySet<string> = new Set(["RC13bEU", "RC13bDrittland", "IGE19", "IGE7"]);

/**
 * Privater Teil (Netto und Steuer) je Steuerschlüssel eines Erwerbs, aus den Beträgen und dem Privatanteil des Belegs, je
 * Satz gerundet wie in documentRatePosting (#1502)
 */
export function privatJeErwerbssatz(amounts: readonly { taxRate: number; net: Cents; tax: Cents }[], privateShare: Prozent): Map<string, Cents> {
  const result = new Map<string, Cents>();
  for (const a of amounts) {
    const code = a.taxRate === 1900 ? "IGE19" : a.taxRate === 700 ? "IGE7" : null;
    if (!code) continue;
    const privat = splitPrivateShare(a.net, privateShare).private + splitPrivateShare(a.tax, privateShare).private;
    result.set(code, (result.get(code) ?? 0) + privat);
  }
  return result;
}

/**
 * Die Zeilen einer Belegbuchung, bei einer Buchung von vor #551 mit der Bemessungsgrundlage wie heute; `privatJeSchluessel`:
 * der private Teil je Steuerschlüssel aus dem Beleg (privatJeErwerbssatz), nur für den Erwerb zu zwei Sätzen nötig
 */
export function mitBemessungWieHeute(
  kontenrahmen: Kontenrahmen,
  zeilen: readonly JournalZeile[],
  privatJeSchluessel?: ReadonlyMap<string, Cents>,
): JournalZeile[] {
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
  if (aufwand.size === 1) add([...aufwand.keys()][0]!, privat);
  else if (privat !== 0) {
    // Erwerb zu 19 % und 7 % mit Privatanteil: Aus dem Journal allein lässt sich der private Teil keinem Satz centgenau
    // zuordnen, ohne ihn wäre auch der Abzug der Steuer falsch. Mit der Aufteilung aus dem Beleg, wenn sie in der Summe
    // genau den gebuchten Teil ergibt (beim Storno mit umgekehrtem Vorzeichen); sonst wie gebucht.
    const aufteilung = [...(privatJeSchluessel ?? [])].filter(([, betrag]) => betrag !== 0);
    const summe = aufteilung.reduce((s, [, betrag]) => s + betrag, 0);
    const vorzeichen = summe === privat ? 1 : summe === -privat ? -1 : 0;
    if (vorzeichen === 0 || aufteilung.some(([code]) => !aufwand.has(code))) return [...zeilen];
    for (const [code, betrag] of aufteilung) add(code, vorzeichen * betrag);
  }
  return zeilen.map((z, i) => {
    for (const [code, index] of aufwand) {
      const k = korrektur.get(code) ?? 0;
      if (index === i && k !== 0) return { ...z, basis: z.debit - z.credit + k };
    }
    return z;
  });
}
