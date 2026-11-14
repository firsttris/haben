import { paragraph4Nummer, paragraph4NummerText, steuerfreiEinordnung, type Cents, type Paragraph4Nummer } from "@haben/core";
import type { RevenueSource } from "../umsatzsteuer/index.ts";

export interface Kz48Gesperrt {
  /** Rechnungsnummer oder „Kasse“ bei einer Bareinnahme ohne Rechnung */
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
 * kommt aus dem Befreiungsgrund der Rechnung. Bareinnahmen und Texte ohne lesbare Nummer bleiben gesperrt.
 */
export function kz48Einordnen(sources: readonly RevenueSource[]): Kz48Ergebnis {
  let zeile46 = 0;
  let zeile47 = 0;
  const nummern47 = new Map<string, Paragraph4Nummer>();
  const gesperrt: Kz48Gesperrt[] = [];
  for (const source of sources) {
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
