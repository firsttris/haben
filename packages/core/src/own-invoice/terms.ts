/*
 * Wörter im Umfeld einer Kennung (USt-IdNr., Steuernummer, IBAN), die verraten, wem sie gehört. Verglichen wird ohne
 * Groß- und Kleinschreibung, Umlaute und Satzzeichen (siehe `normalizeText`), deshalb stehen die Begriffe hier in dieser
 * Form: „Leistungsempfänger“ als „leistungsempfanger“. Ein Begriff trifft am Wortanfang, „kunde“ also auch „Kundennummer“.
 * Neue Schreibweisen gehören einfach in die Listen.
 */

/** Die Kennung gehört dem Empfänger der Rechnung */
export const BUYER_TERMS = [
  // Deutsch
  "ihre",
  "ihr",
  "kunde",
  "kunden",
  "kd",
  "kaufer",
  "besteller",
  "auftraggeber",
  "rechnungsempfanger",
  "leistungsempfanger",
  "empfanger",
  "rechnungsanschrift",
  "rechnungsadresse",
  "lieferanschrift",
  "steuerschuldnerschaft des leistungsempfangers",
  "steuerschuldnerschaft",
  "13b",
  "innergemeinschaftliche lieferung",
  "steuerfreie innergemeinschaftliche",
  // Englisch
  "your",
  "customer",
  "client",
  "buyer",
  "purchaser",
  "recipient",
  "bill to",
  "billed to",
  "invoice to",
  "ship to",
  "sold to",
  "reverse charge",
  "intra community supply",
  "vat exempt intra",
] as const;

/** Die Kennung gehört dem Rechnungssteller */
export const SELLER_TERMS = [
  // Deutsch
  "unsere",
  "unser",
  "rechnungssteller",
  "rechnungsaussteller",
  "aussteller",
  "verkaufer",
  "lieferant",
  "leistender",
  "leistungserbringer",
  "absender",
  "anbieter",
  "geschaftsfuhrer",
  "geschaftsfuhrung",
  "inhaber",
  "inhaberin",
  "vorstand",
  "hrb",
  "hra",
  "handelsregister",
  "registergericht",
  "amtsgericht",
  "sitz der gesellschaft",
  "sitz",
  "bankverbindung",
  "kontoverbindung",
  "zahlbar",
  "bitte uberweisen",
  "uberweisen sie",
  "zahlungsempfanger",
  "kontoinhaber",
  // Englisch
  "our",
  "seller",
  "supplier",
  "vendor",
  "issuer",
  "issued by",
  "managing director",
  "registered office",
  "company register",
  "bank details",
  "pay to",
  "payable to",
  "remit to",
] as const;

/** Die eigene IBAN steht da, weil der andere von ihr abbucht oder dorthin erstattet */
export const DEBIT_TERMS = [
  "lastschrift",
  "sepa lastschrift",
  "lastschriftmandat",
  "mandat",
  "mandatsreferenz",
  "glaubiger id",
  "glaubiger identifikationsnummer",
  "abgebucht",
  "abbuchung",
  "buchen wir",
  "ziehen wir",
  "eingezogen",
  "einzug",
  "von ihrem konto",
  "ihr konto",
  "ihre bankverbindung",
  "erstattung",
  "gutschrift auf",
  "direct debit",
  "debited",
  "mandate",
  "creditor id",
  "refund",
  "your account",
] as const;

/**
 * Eindeutige Hinweise auf einen Lastschrifteinzug; sie gelten für die ganze Seite, denn der Einzugstext steht oft einige
 * Zeilen über der IBAN (dazwischen Kontoinhaber oder Bank). Ohne die mehrdeutigen Wörter aus `DEBIT_TERMS` wie
 * „Erstattung“, die auch als Rechnungsposition vorkommen.
 */
export const DIRECT_DEBIT_TERMS = [
  "lastschrift",
  "sepa lastschrift",
  "lastschriftmandat",
  "mandatsreferenz",
  "glaubiger id",
  "glaubiger identifikationsnummer",
  "abgebucht",
  "abbuchung",
  "buchen wir",
  "ziehen wir",
  "eingezogen",
  "direct debit",
  "debited",
  "creditor id",
] as const;

/** Klein, ohne Umlaute und Satzzeichen, einfache Leerzeichen; „Kunden-USt-IdNr.:“ → „kunden ust idnr“ */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Ob einer der Begriffe als Wort bzw. Wortanfang im normalisierten Text vorkommt */
export function mentions(normalized: string, terms: readonly string[]): boolean {
  return lastMention(normalized, terms) >= 0;
}

/** Stelle des letzten Begriffs im normalisierten Text, -1 ohne Treffer */
export function lastMention(normalized: string, terms: readonly string[]): number {
  const padded = ` ${normalized}`;
  return Math.max(...terms.map((term) => padded.lastIndexOf(` ${term}`)));
}

/**
 * Wem der Text vor einer Kennung sie zuschreibt: der Begriff, der ihr am nächsten steht, gewinnt. So bleibt
 * „Ihre USt-IdNr. DE1… · Unsere USt-IdNr. DE2…“ für die zweite Nummer beim Rechnungssteller.
 */
export function roleBefore(text: string): "buyer" | "seller" | null {
  const normalized = normalizeText(text);
  const buyer = lastMention(normalized, BUYER_TERMS);
  const seller = lastMention(normalized, SELLER_TERMS);
  if (buyer < 0 && seller < 0) return null;
  return buyer > seller ? "buyer" : "seller";
}
