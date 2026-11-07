import { isOwnUstId, mentionsOwnName, ownSteuernummerDigits } from "./company-match.ts";
import { compactId, digitsOf, occurrences, ustIdsIn } from "./identifiers.ts";
import { signal } from "./signal.ts";
import { DEBIT_TERMS, DIRECT_DEBIT_TERMS, mentions, normalizeText, roleBefore } from "./terms.ts";
import type { OwnCompany, OwnInvoiceRule, OwnInvoiceSignal, TextLine } from "./types.ts";

/*
 * Regeln auf der Textebene eines PDFs. Die eigene USt-IdNr. allein sagt wenig: Auf Rechnungen mit Reverse Charge
 * oder innergemeinschaftlicher Lieferung steht auch die des Empfängers. Entscheidend sind der Text unmittelbar davor
 * („Ihre USt-IdNr.“, „Unsere USt-IdNr.“) und die Lage auf der Seite: Deutsche Geschäftsbriefe tragen die Angaben des
 * Absenders in der Fußzeile und in der Absenderzeile über dem Anschriftfeld (DIN 5008), der Empfänger steht im
 * Anschriftfeld oder im Rumpf.
 */

/** Ab hier beginnt die Fußzeile (Anteil der Seitenhöhe) */
export const FOOTER_FROM = 0.8;
/** Bis hier reicht der Briefkopf */
export const HEADER_TO = 0.12;
/** Anschriftfeld nach DIN 5008: Form A ab 27 mm, Form B bis 90 mm von oben, auf A4 (297 mm) also etwa 9 % bis 32 % */
const ADDRESS_FIELD = { from: 0.09, to: 0.32, leftTo: 0.5 };
/**
 * Informationsblock nach DIN 5008 rechts neben dem Anschriftfeld: Angaben des Absenders zum Vorgang (Rechnungsnummer,
 * Kundennummer, eigene USt-IdNr.); reicht etwas tiefer als das Anschriftfeld
 */
const INFO_BLOCK = { from: 0.09, to: 0.36, leftFrom: 0.5 };

type Region = "footer" | "header" | "address" | "info" | "body";

export function regionOf(line: TextLine): Region {
  if (line.top >= FOOTER_FROM) return "footer";
  if (line.top < HEADER_TO) return "header";
  if (line.top >= ADDRESS_FIELD.from && line.top < ADDRESS_FIELD.to && line.left < ADDRESS_FIELD.leftTo) return "address";
  if (line.top >= INFO_BLOCK.from && line.top < INFO_BLOCK.to && line.left >= INFO_BLOCK.leftFrom) return "info";
  return "body";
}

/**
 * Text vor der Kennung: auf derselben Zeile, und steht dort keine Zuordnung, die Zeile darüber (Tabellenkopf,
 * Beschriftung über dem Wert). Die Zeile darüber zählt nur als reine Beschriftung ohne Ziffern: „Kundennummer: 10042“
 * ist eine eigene Angabe, keine Beschriftung der USt-IdNr. darunter.
 */
function roleOf(lines: TextLine[], index: number, at: number): "buyer" | "seller" | null {
  const line = lines[index]!;
  const sameLine = roleBefore(line.text.slice(0, at));
  if (sameLine) return sameLine;
  const previous = lines[index - 1];
  return previous && previous.page === line.page && !/\d/.test(previous.text) ? roleBefore(previous.text) : null;
}

/** Jede Fundstelle einer kompakten Kennung mit Zeilennummer und Stelle in der Zeile */
function findAll(lines: TextLine[], compactNeedle: string): { index: number; at: number }[] {
  return lines.flatMap((line, index) => occurrences(line.text, compactNeedle).map((at) => ({ index, at })));
}

/** Bewertet die Fundstellen einer eigenen Kennung nach Zuordnung im Text und Lage auf der Seite */
function judgeOwnIdentifier(
  lines: TextLine[],
  needle: string,
  rule: string,
  label: string,
  weights: { label: number; footer: number; header: number; buyer: number },
  /** Fundstelle im Rumpf ohne Beschriftung */
  elsewhere: (rule: string) => OwnInvoiceSignal,
): OwnInvoiceSignal[] {
  return findAll(lines, needle).map(({ index, at }) => {
    const role = roleOf(lines, index, at);
    if (role === "buyer") return signal(rule, "foreign", weights.buyer, `${label} ist im Text als Angabe des Empfängers beschriftet.`);
    if (role === "seller") return signal(rule, "own", weights.label, `${label} ist im Text als Angabe des Rechnungsstellers beschriftet.`);
    const region = regionOf(lines[index]!);
    if (region === "footer") return signal(rule, "own", weights.footer, `${label} steht in der Fußzeile, wo der Rechnungssteller seine Angaben macht.`);
    if (region === "header") return signal(rule, "own", weights.header, `${label} steht im Briefkopf.`);
    if (region === "info") return signal(rule, "own", weights.header, `${label} steht im Informationsblock neben dem Anschriftfeld.`);
    return elsewhere(rule);
  });
}

export const ustIdInTextRule: OwnInvoiceRule = ({ lines }, company) => {
  const own = compactId(company.ustId);
  if (!lines || own.length < 7) return [];
  return judgeOwnIdentifier(lines, own, "ust-id-im-text", "Deine USt-IdNr.", { label: 0.85, footer: 0.7, header: 0.5, buyer: 0.85 }, (rule) =>
    signal(rule, "foreign", 0.3, "Deine USt-IdNr. steht im Rumpf der Rechnung, wie bei Angaben zum Empfänger."),
  );
};

/** Empfänger nennen ihre Steuernummer so gut wie nie; steht die eigene auf dem Beleg, ist er fast sicher selbst ausgestellt */
export const steuernummerInTextRule: OwnInvoiceRule = ({ lines }, company) => {
  if (!lines) return [];
  return ownSteuernummerDigits(company).flatMap((digits) =>
    judgeOwnIdentifier(lines, digits, "steuernummer-im-text", "Deine Steuernummer", { label: 0.95, footer: 0.95, header: 0.9, buyer: 0.7 }, (rule) =>
      signal(rule, "own", 0.9, "Deine Steuernummer steht auf dem Beleg; Empfänger geben ihre fast nie an."),
    ),
  );
};

/**
 * Die eigene IBAN steht auf eigenen Rechnungen als Zahlungsziel, auf fremden nur, wenn der andere davon abbucht oder
 * dorthin erstattet (Lastschrift, Mandat).
 */
export const ibanInTextRule: OwnInvoiceRule = ({ lines }, company) => {
  const own = compactId(company.iban);
  if (!lines || own.length < 15) return [];
  return findAll(lines, own).map(({ index, at }) => {
    const line = lines[index]!;
    const previous = lines[index - 1];
    const context = normalizeText(`${previous?.page === line.page ? previous.text : ""} ${line.text}`);
    if (mentions(context, DEBIT_TERMS)) {
      return signal("iban-im-text", "foreign", 0.75, "Deine IBAN steht im Zusammenhang mit einer Lastschrift oder Erstattung.");
    }
    // Außerhalb der Fußzeile ist die eigene IBAN auf einer Seite mit Lastschrifteinzug das belastete Konto, auch wenn
    // Kontoinhaber oder Bank dazwischen stehen
    if (regionOf(line) !== "footer" && directDebitOnPage(lines, line.page)) {
      return signal("iban-im-text", "foreign", 0.75, "Auf der Seite steht ein Lastschrifteinzug; deine IBAN ist das belastete Konto.");
    }
    const role = roleOf(lines, index, at);
    if (role === "buyer") return signal("iban-im-text", "foreign", 0.6, "Deine IBAN ist im Text als Angabe des Empfängers beschriftet.");
    if (role === "seller" || regionOf(line) === "footer") {
      return signal("iban-im-text", "own", 0.85, "Deine IBAN steht als Bankverbindung des Rechnungsstellers auf dem Beleg.");
    }
    return signal("iban-im-text", "own", 0.6, "Deine IBAN steht auf dem Beleg.");
  });
};

function directDebitOnPage(lines: TextLine[], page: number): boolean {
  return lines.some((line) => line.page === page && mentions(normalizeText(line.text), DIRECT_DEBIT_TERMS));
}

/**
 * Andere USt-IdNrn. in der Fußzeile oder als Angabe des Rechnungsstellers: Dann hat ein anderer die Rechnung
 * ausgestellt. Ist die eigene die einzige auf dem Beleg, spricht das schwach für eine eigene Rechnung.
 */
export const otherUstIdRule: OwnInvoiceRule = ({ lines }, company) => {
  if (!lines || compactId(company.ustId).length < 7) return [];
  const found = lines.flatMap((line, index) => ustIdsIn(line.text).map((id) => ({ id, index })));
  const others = found.filter(({ id }) => !isOwnUstId(company, id));
  const sellerOthers = others.filter(({ id, index }) => {
    const line = lines[index]!;
    const at = occurrences(line.text, id)[0] ?? 0;
    return regionOf(line) === "footer" || roleOf(lines, index, at) === "seller";
  });
  if (sellerOthers.length > 0) {
    return [signal("andere-ust-id", "foreign", 0.65, `In der Fußzeile bzw. beim Rechnungssteller steht eine andere USt-IdNr. (${sellerOthers[0]!.id}).`)];
  }
  if (others.length === 0 && found.length > 0) {
    return [signal("andere-ust-id", "own", 0.35, "Auf dem Beleg steht keine andere USt-IdNr. als deine.")];
  }
  return [];
};

/** Eine beschriftete Steuernummer: „Steuernummer 99/123/45678“, „St.-Nr.: 2181508150“; nicht in „Versicherungsteuer-Nr.“ */
const STEUERNUMMER = /(?<!\p{L})(?:steuer[-\s]?(?:nummer|nr\.?)|st\.?[-\s]?nr\.?)\s*:?\s*(\d[\d/]{8,15}\d)/giu;

/**
 * Eine andere Steuernummer in der Fußzeile oder als Angabe des Rechnungsstellers: Dann hat ein anderer die Rechnung
 * ausgestellt (Pflichtangabe nach § 14 Abs. 4 Nr. 2 UStG, oft statt der USt-IdNr.). Die eigene Steuernummer steht dann
 * z. B. im Betreff einer Rechnung der Steuerberatung.
 */
export const otherSteuernummerRule: OwnInvoiceRule = ({ lines }, company) => {
  const own = ownSteuernummerDigits(company);
  if (!lines || own.length === 0) return [];
  const other = lines.findIndex((line, index) =>
    [...line.text.matchAll(STEUERNUMMER)].some((match) => {
      const digits = digitsOf(match[1]!);
      if (digits.length < 10 || digits.length > 13 || own.includes(digits)) return false;
      return regionOf(line) === "footer" || roleOf(lines, index, match.index) === "seller";
    }),
  );
  return other >= 0
    ? [signal("andere-steuernummer", "foreign", 0.65, "In der Fußzeile bzw. beim Rechnungssteller steht eine andere Steuernummer als deine.")]
    : [];
};

/**
 * Der eigene Firmenname in Fußzeile, Briefkopf oder Absenderzeile (eine Zeile mit Name und eigener PLZ über dem
 * Anschriftfeld) spricht für den Absender, im Anschriftfeld für den Empfänger.
 */
export const nameInTextRule: OwnInvoiceRule = ({ lines }, company) => {
  if (!lines) return [];
  return lines.flatMap((line) => {
    if (!mentionsOwnName(company, line.text)) return [];
    return nameSignal(line, company);
  });
};

function nameSignal(line: TextLine, company: OwnCompany): OwnInvoiceSignal[] {
  const region = regionOf(line);
  const withPlz = company.plz.length >= 4 && line.text.includes(company.plz);
  if (region === "footer") return [signal("name-im-text", "own", 0.45, "Dein Firmenname steht in der Fußzeile.")];
  if (withPlz && line.top < ADDRESS_FIELD.to) return [signal("name-im-text", "own", 0.5, "Dein Firmenname steht mit deiner Anschrift in der Absenderzeile.")];
  if (region === "header") return [signal("name-im-text", "own", 0.4, "Dein Firmenname steht im Briefkopf.")];
  if (region === "address") return [signal("name-im-text", "foreign", 0.45, "Dein Firmenname steht im Anschriftfeld, also als Empfänger.")];
  return [];
}

export const TEXT_RULES: OwnInvoiceRule[] = [ustIdInTextRule, steuernummerInTextRule, ibanInTextRule, otherUstIdRule, otherSteuernummerRule, nameInTextRule];
