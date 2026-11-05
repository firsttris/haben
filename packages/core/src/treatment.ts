import { normalizeUstId, ustIdProblem } from "./zm.ts";

/**
 * Umsatzsteuerliche Behandlung einer Ausgangsrechnung. Außer „regulaer“ stehen alle Positionen
 * auf 0 %; die Behandlung bestimmt Erlöskonto, Kennzahl der Voranmeldung, die Steuerkategorie
 * der E-Rechnung und den Pflichthinweis auf der Rechnung.
 */
export const TAX_TREATMENTS = {
  regulaer: {
    label: "Regulär besteuert (19 %, 7 % oder 0 %)",
    category: null,
    reasonCode: null,
    note: null,
  },
  reverse_charge: {
    label: "Reverse Charge: Leistung an Unternehmen im EU-Ausland",
    category: "AE",
    reasonCode: "VATEX-EU-AE",
    note: "Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge, Art. 196 MwStSystRL).",
  },
  drittland: {
    label: "Leistung ins Nicht-EU-Ausland (im Inland nicht steuerbar)",
    category: "O",
    reasonCode: "VATEX-EU-O",
    note: "Im Inland nicht steuerbare Leistung (Leistungsort im Drittland).",
  },
  // Lieferung eines Gegenstands an einen Unternehmer in einem anderen EU-Mitgliedstaat (§ 4 Nr. 1 Buchst. b, § 6a UStG):
  // Steuerkategorie K „Intra-community supply“ mit Befreiungscode VATEX-EU-IC (EN 16931, Codeliste VATEX)
  ig_lieferung: {
    label: "Innergemeinschaftliche Lieferung (steuerfrei, § 4 Nr. 1 Buchst. b UStG)",
    category: "K",
    reasonCode: "VATEX-EU-IC",
    note: "Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1 Buchst. b, § 6a UStG).",
  },
  // Lieferung eines Gegenstands ins Drittland (§ 4 Nr. 1 Buchst. a, § 6 UStG): Kategorie G „Free export item, VAT not
  // charged“ mit VATEX-EU-G. Sonstige Leistungen ins Drittland sind nicht steuerbar, siehe „drittland“.
  ausfuhr: {
    label: "Ausfuhrlieferung ins Drittland (steuerfrei, § 4 Nr. 1 Buchst. a UStG)",
    category: "G",
    reasonCode: "VATEX-EU-G",
    note: "Steuerfreie Ausfuhrlieferung (§ 4 Nr. 1 Buchst. a, § 6 UStG).",
  },
  steuerfrei: {
    label: "Steuerfrei nach § 4 UStG",
    category: "E",
    reasonCode: null,
    note: "Steuerfreie Leistung nach § 4 UStG.",
  },
  kleinunternehmer: {
    label: "Kleinunternehmer nach § 19 UStG",
    category: "E",
    reasonCode: null,
    note: "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.",
  },
} as const;

export type TaxTreatment = keyof typeof TAX_TREATMENTS;

/** Mitgliedstaaten der EU als Ländercode nach ISO 3166-1 (Griechenland GR; in der USt-IdNr. EL) */
export const EU_COUNTRIES: ReadonlySet<string> = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
]);

export const TAX_TREATMENT_KEYS = Object.keys(TAX_TREATMENTS) as [TaxTreatment, ...TaxTreatment[]];

/** Hinweis auf der Rechnung: eigener Text (z. B. die genaue Befreiungsvorschrift) oder der Standardtext */
export function treatmentNote(treatment: TaxTreatment, exemptionReason?: string | null): string | null {
  if (treatment === "regulaer") return null;
  return exemptionReason?.trim() || TAX_TREATMENTS[treatment].note;
}

/** Was an einer Rechnung mit dieser Behandlung fehlt oder nicht passt; leer = in Ordnung. */
export function treatmentIssues(
  treatment: TaxTreatment,
  input: { rates: number[]; sellerUstId?: string; buyerUstId?: string; buyerCountry?: string; exemptionReason?: string | null },
): string[] {
  if (treatment === "regulaer") return [];
  const issues: string[] = [];
  if (input.rates.some((rate) => rate !== 0)) issues.push(`${TAX_TREATMENTS[treatment].label}: alle Positionen müssen 0 % haben`);
  const country = input.buyerCountry?.toUpperCase();
  if (treatment === "reverse_charge") {
    if (!input.sellerUstId?.trim()) issues.push("Reverse Charge braucht deine USt-IdNr. in den Firmendaten");
    if (!input.buyerUstId?.trim()) issues.push("Reverse Charge braucht die USt-IdNr. des Kunden");
    if (country === "DE") issues.push("Reverse Charge gilt nur für Kunden im EU-Ausland");
  }
  if (treatment === "ig_lieferung") {
    // § 14a Abs. 3 UStG: auf der Rechnung die USt-IdNr. von Lieferer und Abnehmer; § 6a Abs. 1 Satz 1 Nr. 4: der Abnehmer
    // verwendet eine ihm von einem anderen Mitgliedstaat erteilte USt-IdNr. Geprüft wie in der Zusammenfassenden Meldung.
    if (!input.sellerUstId?.trim()) issues.push("Innergemeinschaftliche Lieferung braucht deine USt-IdNr. in den Firmendaten (§ 14a Abs. 3 UStG)");
    const buyerUstId = normalizeUstId(input.buyerUstId ?? "");
    if (!buyerUstId) issues.push("Innergemeinschaftliche Lieferung braucht die USt-IdNr. des Kunden (§ 6a Abs. 1 Nr. 4 UStG)");
    else {
      const problem = ustIdProblem(buyerUstId, "L");
      if (problem) issues.push(problem);
    }
    // Nordirland gehört für Waren weiter zum Gemeinschaftsgebiet (XI-Nummer bei Ländercode GB)
    const nordirland = country === "GB" && buyerUstId.startsWith("XI");
    if (country && (country === "DE" || !(EU_COUNTRIES.has(country) || nordirland))) {
      issues.push("Innergemeinschaftliche Lieferung nur an Kunden in einem anderen EU-Mitgliedstaat");
    }
  }
  if (treatment === "ausfuhr") {
    // EN 16931 BR-G-02: Kategorie G verlangt die USt-IdNr. des Verkäufers (BT-31) oder seines Steuervertreters
    if (!input.sellerUstId?.trim()) issues.push("Ausfuhrlieferung braucht deine USt-IdNr. in den Firmendaten (EN 16931 BR-G-02)");
    // Haben nimmt die Anschrift des Kunden als Bestimmungsort; liegt sie in der EU, passt die Ausfuhr nicht
    if (country && EU_COUNTRIES.has(country)) {
      issues.push("Ausfuhrlieferung nur an Kunden außerhalb der EU; im Gemeinschaftsgebiet ist es eine innergemeinschaftliche Lieferung");
    }
  }
  if (treatment === "drittland" && country === "DE") issues.push("Der Kunde sitzt in Deutschland; die Leistung ist im Inland steuerbar");
  if (treatment === "steuerfrei" && !input.exemptionReason?.trim()) {
    issues.push("Bei steuerfreien Umsätzen bitte die Vorschrift angeben, z. B. „Steuerfrei nach § 4 Nr. 14 UStG“");
  }
  return issues;
}
