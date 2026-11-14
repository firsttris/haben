import type { Cents } from "./money.ts";

/** Strukturierte, fachlich zugeordnete Vorschrift; alte freie Befreiungstexte sind keine solche Zuordnung. */
export interface Section4Provision {
  /** Nummer einschließlich eines etwaigen Zusatzes, etwa „14“, „4b“ oder „15a“ */
  number: string;
  letter?: string | null;
}

export type TurnoverClassification =
  | { kind: "domestic" }
  | { kind: "section4"; provision: Section4Provision | null; ancillary: boolean | null }
  | { kind: "foreign"; confirmed: boolean }
  | { kind: "asset_disposal" }
  | { kind: "not_turnover" };

export type TurnoverDecision = "included" | "excluded" | "unknown";
export interface TurnoverOutcome {
  decision: TurnoverDecision;
  reason: string;
}

/** Tatsächliches Entgelt oder steuerbare Wertabgabe; Rechnung, Schlussrechnung und Ausbuchung sind keine Zahlungen. */
export interface TurnoverItem {
  source: "bank" | "cash" | "legacy" | "journal" | "privateUse";
  sourceId: string;
  occurredOn: string | null;
  /** Vereinnahmtes Nettoentgelt mit Vorzeichen, nicht Brutto, Rechnungsbetrag oder EÜR-Gewinn. */
  net: Cents | null;
  basisSource: "stored" | "derived" | "unknown";
  classification: TurnoverClassification | null;
}

export interface TurnoverResult {
  year: number;
  included: Cents;
  complete: boolean;
  items: (TurnoverItem & TurnoverOutcome)[];
}

const deductedNumbers = new Set([
  "11",
  "11a",
  "11b",
  "12",
  "13",
  "14",
  "15",
  "15a",
  "15b",
  "15c",
  "16",
  "17",
  "18",
  "18a",
  "19",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "29",
]);
const includedNumbers = new Set(["1", "2", "3", "4", "4b", "4c", "5", "6", "7"]);
const outcome = (decision: TurnoverDecision, reason: string): TurnoverOutcome => ({ decision, reason });

/**
 * Zählregel für tatsächlich befreite Umsätze, keine Prüfung der persönlichen/sachlichen Befreiungsvoraussetzungen.
 * § 19 Abs. 2 UStG: https://www.gesetze-im-internet.de/ustg_1980/__19.html
 * Die Vorschriften sind in § 4 aufgeführt: https://www.gesetze-im-internet.de/ustg_1980/__4.html
 */
function section4Outcome(provision: Section4Provision | null, ancillary: boolean | null): TurnoverOutcome {
  if (!provision) return outcome("unknown", "Die Befreiungsvorschrift ist noch nicht strukturiert zugeordnet.");
  const { number } = provision;
  const letter = provision.letter?.trim().toLowerCase() ?? "";
  if (deductedNumbers.has(number) || (number === "8" && letter === "i") || (number === "9" && letter === "b")) {
    return outcome("excluded", "Diese Steuerbefreiung wird nach § 19 Abs. 2 Satz 1 Nr. 1 abgezogen.");
  }
  if ((number === "8" && /^[a-h]$/.test(letter)) || (number === "9" && letter === "a") || (number === "10" && ["", "a", "b"].includes(letter))) {
    if (typeof ancillary !== "boolean") return outcome("unknown", "Die Einordnung als Hilfsumsatz fehlt.");
    return ancillary
      ? outcome("excluded", "Dieser steuerfreie Hilfsumsatz wird nach § 19 Abs. 2 Satz 1 Nr. 2 abgezogen.")
      : outcome("included", "Dieser steuerfreie Umsatz zählt außerhalb eines Hilfsumsatzes zum Gesamtumsatz.");
  }
  if (includedNumbers.has(number)) return outcome("included", "Diese Steuerbefreiung ist kein Abzug nach § 19 Abs. 2 Satz 1.");
  return outcome("unknown", "Die Befreiungsvorschrift ist nicht ausreichend oder nicht unterstützt.");
}

/** Keine Einordnung aus Kontonummer, Freitext, Kundenland oder dem heutigen Kleinunternehmerstatus ableiten. */
export function classifyTurnover(classification: TurnoverClassification | null): TurnoverOutcome {
  if (!classification) return outcome("unknown", "Die Umsatzart ist noch ungeklärt.");
  switch (classification.kind) {
    case "domestic":
      return outcome("included", "Im Inland steuerbarer Umsatz ohne Abzug nach § 19 Abs. 2.");
    case "section4":
      return section4Outcome(classification.provision, classification.ancillary);
    case "foreign":
      return classification.confirmed
        ? outcome("excluded", "Der Leistungsort im Ausland ist bestätigt; der Umsatz ist nicht im Inland steuerbar.")
        : outcome("unknown", "Der tatsächliche ausländische Leistungsort ist noch ungeklärt.");
    case "asset_disposal":
      return outcome("excluded", "Umsätze mit Anlagevermögen bleiben nach § 19 Abs. 2 Satz 2 außer Ansatz.");
    case "not_turnover":
      return outcome("excluded", "Kein Entgelt einer steuerbaren Ausgangsleistung.");
  }
}

function isDay(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function evaluate(item: TurnoverItem, year: number): TurnoverOutcome {
  const occurredOn = item.occurredOn;
  const validDay = isDay(occurredOn);
  if (validDay && !occurredOn.startsWith(`${year}-`)) return outcome("excluded", "Der Zahlungstag liegt außerhalb des gewählten Jahres.");
  const classification = classifyTurnover(item.classification);
  if (classification.decision !== "included") return classification;
  if (!validDay) return outcome("unknown", "Der tatsächliche Zahlungstag ist noch ungeklärt.");
  if (item.net === null || !Number.isSafeInteger(item.net) || item.basisSource === "unknown") {
    return outcome("unknown", "Das vereinnahmte Nettoentgelt oder dessen Herkunft ist noch ungeklärt.");
  }
  return classification;
}

/**
 * Zahlungsbezogene Grundlage der seit 2025 geltenden Fassung, unabhängig von Ist/Soll und Gewinnermittlung.
 * Frühere Jahre werden nicht stillschweigend nach dieser Fassung berechnet. Die Warnschwellen sind ein eigener Schritt.
 * Die Quellenidentität kommt vom Zahlungsleser; nur sicher identische Quellen werden als doppelt zurückgewiesen.
 */
export function turnoverForYear(year: number, sourceItems: readonly TurnoverItem[]): TurnoverResult {
  if (!Number.isInteger(year) || year < 2025 || year > 2100) throw new RangeError("Diese Gesamtumsatzberechnung unterstützt Jahre von 2025 bis 2100.");
  const seen = new Set<string>();
  const items = sourceItems.map((item) => {
    const key = `${item.source}:${item.sourceId}`;
    if (seen.has(key)) throw new RangeError(`Umsatzquelle doppelt: ${key}`);
    seen.add(key);
    return { ...item, ...evaluate(item, year) };
  });
  let included = 0;
  for (const item of items) {
    if (item.decision !== "included") continue;
    included += item.net!;
    if (!Number.isSafeInteger(included)) throw new RangeError("Der Gesamtumsatz überschreitet den sicheren ganzzahligen Centbereich.");
  }
  return { year, included, complete: items.every((item) => item.decision !== "unknown"), items };
}
