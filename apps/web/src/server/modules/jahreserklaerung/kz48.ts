import { paragraph4Nummer, paragraph4NummerText, steuerfreiEinordnung, type Cents, type Paragraph4Nummer } from "@haben/core";
import type { RevenueSource } from "../umsatzsteuer/index.ts";

export interface Kz48Gesperrt {
  /** Rechnungsnummer, „Kasse“ bei einer Bareinnahme ohne Rechnung oder der Monat bei Buchungen ohne Rechnung */
  quelle: string;
  /** Befreiungsgrund der Rechnung bzw. der Text der Bareinnahme */
  text: string;
  betrag: Cents;
  /** nummer: keine lesbare oder zuordenbare Nummer; hilfsumsatz: § 4 Nr. 8 a–h, 9 a, 10 (UStAE 19.3 Abs. 2) */
  grund: "nummer" | "hilfsumsatz";
}

export interface Kz48Ergebnis {
  /** Summen in Cent; der Aufrufer bringt sie wie die anderen Bemessungsgrundlagen auf volle Euro */
  zeile46: Cents;
  zeile47: Cents;
  /** Nummern der Zeile 47 aufsteigend nach Nummer, dann Buchstabe, als Text fürs Feld E3104501 („8 i, 14, 21“) */
  nummern: string;
  gesperrt: Kz48Gesperrt[];
}

/**
 * Steuerfreie Umsätze ohne Vorsteuerabzug (Kz 48) auf die Zeilen 46 und 47 verteilen: die Nummer in § 4 UStG
 * kommt aus dem Befreiungsgrund der Rechnung. Bareinnahmen und Texte ohne lesbare Nummer bleiben gesperrt, ebenso
 * der Teil von Kz 48 eines Monats, zu dem es keine Quelle gibt: Ab dem Stichjahr kommt Kz 48 aus dem Journal, und
 * eine Buchung ohne Rechnung (etwa aus einem Umzug) hat keinen Befreiungsgrund.
 */
export function kz48Einordnen(months: readonly { kz48: Cents; revenue: readonly RevenueSource[] }[], year: number): Kz48Ergebnis {
  let zeile46 = 0;
  let zeile47 = 0;
  const nummern47 = new Map<string, Paragraph4Nummer>();
  const gesperrt: Kz48Gesperrt[] = [];
  for (const source of months.flatMap((m) => m.revenue)) {
    if (source.treatment !== "steuerfrei") continue;
    const einordnung = steuerfreiEinordnung(paragraph4Nummer(source.exemptionReason ?? ""));
    if ("zeile" in einordnung) {
      if (einordnung.zeile === 46) {
        zeile46 += source.base;
        continue;
      }
      zeile47 += source.base;
      nummern47.set(paragraph4NummerText(einordnung.nummer!), einordnung.nummer!);
      continue;
    }
    gesperrt.push({
      quelle: source.type === "kasse" ? "Kasse" : source.number,
      text: source.type === "kasse" ? source.customer : (source.exemptionReason ?? ""),
      betrag: source.base,
      grund: einordnung.gesperrt,
    });
  }
  months.forEach((month, i) => {
    const ausQuellen = month.revenue.filter((r) => r.treatment === "steuerfrei").reduce((s, r) => s + r.base, 0);
    const rest = month.kz48 - ausQuellen;
    if (rest !== 0) gesperrt.push({ quelle: `Buchungen ohne Rechnung ${String(i + 1).padStart(2, "0")}/${year}`, text: "", betrag: rest, grund: "nummer" });
  });
  return {
    zeile46,
    zeile47,
    nummern: [...nummern47.values()]
      .sort((a, b) => a.nummer - b.nummer || (a.buchstabe ?? "").localeCompare(b.buchstabe ?? ""))
      .map(paragraph4NummerText)
      .join(", "),
    gesperrt,
  };
}
