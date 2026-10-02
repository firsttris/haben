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
  if (treatment === "drittland" && country === "DE") issues.push("Der Kunde sitzt in Deutschland; die Leistung ist im Inland steuerbar");
  if (treatment === "steuerfrei" && !input.exemptionReason?.trim()) {
    issues.push("Bei steuerfreien Umsätzen bitte die Vorschrift angeben, z. B. „Steuerfrei nach § 4 Nr. 14 UStG“");
  }
  return issues;
}
