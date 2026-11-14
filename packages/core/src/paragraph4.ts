/**
 * Die Nummer in § 4 UStG aus einem Befreiungsgrund wie „Steuerfrei nach § 4 Nr. 21 UStG“. Sie bestimmt,
 * in welche Zeile der Umsatzsteuererklärung ein steuerfreier Umsatz ohne Vorsteuerabzug gehört: Zeile 46
 * bei Nr. 12 (Vermietung), Zeile 47 bei den übrigen nicht zum Gesamtumsatz gehörenden Umsätzen und
 * Zeile 49 bei Hilfsumsätzen (Anleitung USt 2 E).
 */
export interface Paragraph4Nummer {
  nummer: number;
  /** Buchstabe der Nummer, etwa „i“ bei Nr. 8 i */
  buchstabe?: string;
}

/**
 * Erkennt „§ 4 Nr. 21“, „§4 Nr.21“, „§ 4 Nummer/Ziff./Ziffer 21“ mit und ohne „UStG“ sowie den Buchstaben
 * als „8 a“, „8a“ oder „8 Buchst. a“/„Buchstabe a“. Auch eine Nennung ohne „§ 4“ („Nr. 21“) zählt.
 * null bei einem Bereich („Nr. 8 bis 29“), mehreren Nummern, einem anderen Paragraphen (§ 4a, § 14),
 * einer Nummer über 29 oder ohne Nummer.
 */
export function paragraph4Nummer(text: string): Paragraph4Nummer | null {
  // Steht ein Paragraphenzeichen im Text, muss es genau „§ 4“ sein (nicht § 4a, § 14, § 19); den Buchstaben
  // eines Paragraphen wie § 4a erkennt der zweite Fang nur unmittelbar an der Zahl
  const paragraphen = [...text.matchAll(/§\s*(\d+)([a-z])?/gi)];
  if (paragraphen.length > 0 && (paragraphen.length !== 1 || paragraphen[0]![1] !== "4" || paragraphen[0]![2])) return null;
  // Genau eine Nennung „Nr. <Zahl>“; mehr als eine macht den Text mehrdeutig
  const nennungen = [...text.matchAll(/(?:nr\.?|nummer|ziff\.?|ziffer)\s*(\d{1,2})(?!\d)/gi)];
  if (nennungen.length !== 1) return null;
  const nummer = Number(nennungen[0]![1]);
  // § 4 hat die Nummern 1 bis 29
  if (nummer < 1 || nummer > 29) return null;
  const treffer = nennungen[0]!;
  const danach = text.slice(treffer.index + treffer[0].length);
  // Ein Bereich oder eine Aufzählung („8 bis 29“, „8–29“, „8 und 14“) ist keine einzelne Nummer
  if (/^\s*(?:bis|und|–|—|-|,|\/)\s*\d/i.test(danach)) return null;
  // Buchstabe der Nummer: „8 a“, „8a“, „8 Buchst. a“; ein mehrbuchstabiges Wort (UStG) ist keiner
  const buchstabe = /^\s*(?:(?:buchst\.?|buchstabe)\s*)?([a-z])(?![a-zäöü])/i.exec(danach)?.[1]?.toLowerCase();
  return buchstabe ? { nummer, buchstabe } : { nummer };
}

/** Wie die Nummer ins Textfeld E3104501 der Zeile 47 gehört: „21“ bzw. „8 i“ */
export function paragraph4NummerText(nummer: Paragraph4Nummer): string {
  return `${nummer.nummer}${nummer.buchstabe ? ` ${nummer.buchstabe}` : ""}`;
}

export type SteuerfreiEinordnung =
  /** Zeile 46 (§ 4 Nr. 12) bzw. Zeile 47 mit der Nummer als Text; bei 47 geht die Nummer in E3104501 */
  | { zeile: 46 | 47; nummer?: Paragraph4Nummer }
  /**
   * nummer: keine lesbare oder nicht zuordenbare Nummer (Bereich, mehrere, Nr. 1 bis 7, 8/9 ohne Buchstabe);
   * hilfsumsatz: § 4 Nr. 8 a bis h, 9 a, 10 — ob diese Umsätze zum Gesamtumsatz gehören (Zeile 49,
   * Hilfsumsatz, UStAE 19.3 Abs. 2), kann Haben nicht entscheiden.
   */
  | { gesperrt: "nummer" | "hilfsumsatz" };

export function steuerfreiEinordnung(nummer: Paragraph4Nummer | null): SteuerfreiEinordnung {
  if (!nummer) return { gesperrt: "nummer" };
  if (nummer.nummer === 12) return { zeile: 46 };
  if (nummer.nummer === 8) {
    if (nummer.buchstabe === "i") return { zeile: 47, nummer };
    return nummer.buchstabe && "abcdefgh".includes(nummer.buchstabe) ? { gesperrt: "hilfsumsatz" } : { gesperrt: "nummer" };
  }
  if (nummer.nummer === 9) {
    if (nummer.buchstabe === "b") return { zeile: 47, nummer };
    return nummer.buchstabe === "a" ? { gesperrt: "hilfsumsatz" } : { gesperrt: "nummer" };
  }
  if (nummer.nummer === 10) return { gesperrt: "hilfsumsatz" };
  // Nr. 1 bis 7 steuerfrei mit Vorsteuerabzug (Ausfuhren, ig. Lieferungen) — eigene Behandlung in Haben
  if (nummer.nummer === 11 || nummer.nummer >= 13) return { zeile: 47, nummer };
  return { gesperrt: "nummer" };
}
