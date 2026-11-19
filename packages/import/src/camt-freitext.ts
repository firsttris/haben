import { isValidBic, isValidIban } from "@haben/core";
import { normalizeIban, normalizeText } from "./text.ts";

export interface FreitextGegenpartei {
  name: string;
  iban: string | undefined;
}

const UEBERWEISUNG = /^(Eingehende Überweisung Von|Ausgehende Überweisung An) (.+) (\S+) (\S+)$/;
// Händler bis zum ersten Komma, davor ein Kürzel aus sechs Buchstaben und Ziffern (mindestens eine Ziffer, sonst
// wäre es vom letzten Wort des Händlers nicht zu unterscheiden), danach Ort und Land
const KARTE = /^Kartentransaktion ([^,]+) (?=[A-Za-z]*\d)[A-Za-z0-9]{6}, .+$/;

function ueberweisung(match: RegExpExecArray, purpose: string, credit: boolean): FreitextGegenpartei | undefined {
  const [, richtung, mitte, iban, bic] = match as unknown as [string, string, string, string, string];
  if (richtung.startsWith("Eingehende") !== credit) return undefined;
  if (!isValidIban(iban) || !isValidBic(bic)) return undefined;
  if (purpose === "" || !mitte.endsWith(` ${purpose}`)) return undefined;
  const name = normalizeText(mitte.slice(0, -purpose.length - 1));
  return name === "" ? undefined : { name, iban: normalizeIban(iban) };
}

/**
 * Gegenpartei aus dem Freitext (AddtlTxInf, AddtlNtryInf), wenn RltdPties fehlt. So exportiert Vivid Business
 * CAMT.053: „Eingehende Überweisung Von <Name> <Zweck> <IBAN> <BIC>“, „Ausgehende Überweisung An …“ und
 * „Kartentransaktion <Händler> <Kürzel>, <Ort>, <Land>“. Passt der Text nicht genau, bleibt die Gegenpartei leer.
 */
export function gegenparteiAusFreitext(freitext: string, purpose: string, credit: boolean): FreitextGegenpartei | undefined {
  const text = normalizeText(freitext);
  const transfer = UEBERWEISUNG.exec(text);
  if (transfer) return ueberweisung(transfer, purpose, credit);
  const karte = KARTE.exec(text);
  if (!karte) return undefined;
  const name = normalizeText(karte[1]);
  return name === "" ? undefined : { name, iban: undefined };
}
