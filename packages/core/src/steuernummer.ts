/**
 * Umrechnung der Steuernummer vom Bescheid-Format ins bundeseinheitliche
 * 13-stellige ELSTER-Format. Die ersten vier Stellen sind die Finanzamtsnummer.
 */

export const BUNDESLAENDER = {
  BW: "Baden-Württemberg",
  BY: "Bayern",
  BE: "Berlin",
  BB: "Brandenburg",
  HB: "Bremen",
  HH: "Hamburg",
  HE: "Hessen",
  MV: "Mecklenburg-Vorpommern",
  NI: "Niedersachsen",
  NW: "Nordrhein-Westfalen",
  RP: "Rheinland-Pfalz",
  SL: "Saarland",
  SN: "Sachsen",
  ST: "Sachsen-Anhalt",
  SH: "Schleswig-Holstein",
  TH: "Thüringen",
} as const;

export type Bundesland = keyof typeof BUNDESLAENDER;

/** Länderpräfix und Länge der Steuernummer im Bescheid-Format. */
const RULES: Record<Bundesland, { prefix: string; length: 10 | 11 }> = {
  BW: { prefix: "28", length: 10 },
  BE: { prefix: "11", length: 10 },
  HB: { prefix: "24", length: 10 },
  HH: { prefix: "22", length: 10 },
  NI: { prefix: "23", length: 10 },
  RP: { prefix: "27", length: 10 },
  SH: { prefix: "21", length: 10 },
  BY: { prefix: "9", length: 11 },
  BB: { prefix: "3", length: 11 },
  HE: { prefix: "2", length: 11 },
  MV: { prefix: "4", length: 11 },
  NW: { prefix: "5", length: 11 },
  SL: { prefix: "1", length: 11 },
  SN: { prefix: "3", length: 11 },
  ST: { prefix: "3", length: 11 },
  TH: { prefix: "4", length: 11 },
};

export class SteuernummerError extends Error {}

export function toElsterSteuernummer(steuernummer: string, land: Bundesland): string {
  const digits = steuernummer.replace(/\D/g, "");
  // Bereits im ELSTER-Format
  if (digits.length === 13) return digits;

  const rule = RULES[land];
  if (digits.length !== rule.length) {
    throw new SteuernummerError(
      `Steuernummer für ${BUNDESLAENDER[land]} muss ${rule.length} Ziffern haben, hat ${digits.length}.`,
    );
  }

  const office = digits.slice(0, rule.length - 8);
  const rest = digits.slice(rule.length - 8);
  // Hessen schreibt das Finanzamt als 0FF, ELSTER als 6FF.
  const elsterOffice = land === "HE" ? `6${office.slice(1)}` : office;
  return `${rule.prefix}${elsterOffice}0${rest}`;
}

/** Bundesfinanzamtsnummer: die ersten vier Stellen des ELSTER-Formats. */
export function finanzamtsnummer(elsterSteuernummer: string): string {
  return elsterSteuernummer.slice(0, 4);
}
