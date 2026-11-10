import type { TaxTreatment } from "@haben/core";

/** Steuerart des JSON-Originals (Lexoffice-Namen wie in packages/core/src/legacy-vat.ts) und ihre native Behandlung */
const IMPORT_TAX_TREATMENTS: Record<string, TaxTreatment> = {
  net: "regulaer",
  gross: "regulaer",
  vatfree: "regulaer",
  thirdPartyCountryDelivery: "ausfuhr",
  thirdPartyCountryService: "drittland",
  intraCommunitySupply: "ig_lieferung",
  externalService13b: "reverse_charge",
};

/**
 * Steuerart des JSON-Originals als native Behandlung; sie steuert Erlöskonto, Kennzahl und spätere Zahlungen wie bei
 * einer in Haben geschriebenen Rechnung. Zuordnung wie in legacy-vat.ts (TAX_TYPES): Ausfuhr Kz 43, Leistung ins
 * Drittland Kz 45, innergemeinschaftliche Lieferung Kz 41, sonstige Leistung im EU-Ausland nach § 13b UStG Kz 21.
 * Für § 13b im Inland (Kz 60), Photovoltaik zum Nullsteuersatz (Kz 87) und OSS hat Haben keine Behandlung: Solche
 * Rechnungen werden nicht übernommen, statt als regulär. Lexoffice und sevDesk bleiben wie bisher regulär.
 * Ergebnis: die Behandlung oder der Grund, warum die Rechnung nicht übernommen wird.
 */
export function importedTaxTreatment(voucher: {
  source: string;
  raw: Record<string, unknown>;
  taxes: { rate: number; tax: number }[];
}): { treatment: TaxTreatment } | { problem: string } {
  if (voucher.source !== "import") return { treatment: "regulaer" };
  const subType = voucher.raw.taxSubType;
  if (subType === "distanceSales" || subType === "electronicServices")
    return { problem: "OSS-Umsätze kann Haben nicht als Rechnung übernehmen; den Posten von Hand erfassen." };
  const treatment = IMPORT_TAX_TREATMENTS[typeof voucher.raw.taxType === "string" ? voucher.raw.taxType : "net"];
  if (!treatment) return { problem: "Für die Steuerart des Originals hat Haben keine eigene Behandlung; den Posten von Hand erfassen." };
  if (treatment !== "regulaer" && voucher.taxes.some((t) => t.rate !== 0 || t.tax !== 0))
    return { problem: "Die Steuerart und die Steuerbeträge des Originals widersprechen sich." };
  return { treatment };
}
