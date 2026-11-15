import type { ReconciliationCheck } from "./lexoffice.ts";

/*
 * FastBill im Abgleich je Jahr (reconciliation in lexoffice.ts): Steuerart aus VAT_CASE und der offene Punkt für Ausgaben,
 * die noch auf ihren Beleg aus dem Browser-Skript warten.
 */

/**
 * Steuerart in den Werten von Lexoffice aus VAT_CASE der Rechnung (https://apidocs.fastbill.com/fastbill/en/invoice.html),
 * eingeordnet nach UStG: standard → regulär; small_business_regulation → steuerfrei, nicht gemeldet (§ 19 Abs. 1 UStG);
 * b2b_eu_goods → innergemeinschaftliche Lieferung Kz 41 (§ 4 Nr. 1 Buchst. b, § 6a); b2b_eu_services → sonstige Leistung im
 * übrigen Gemeinschaftsgebiet Kz 21 (§ 3a Abs. 2, § 18b Satz 1 Nr. 2), wie Lexoffice „externalService13b“; b2b_noneu_goods
 * und b2c_noneu_goods → Ausfuhr Kz 43 (§ 4 Nr. 1 Buchst. a, § 6; bei B2C nur, wenn der Unternehmer befördert, § 6 Abs. 1
 * Nr. 2, was die Antwort nicht sagt); b2b_noneu_services → nicht steuerbar Kz 45 (§ 3a Abs. 2). b2c_eu_goods (Fernverkauf,
 * § 3c) bleibt unbekannt: Ob er über OSS lief, steht nicht in der Antwort.
 * Ein echtes Konto (November 2026) lieferte statt der Aufzählung 0/1 („innergemeinschaftlich“). 1 unterscheidet nicht
 * zwischen Lieferung (Kz 41) und sonstiger Leistung (Kz 21) und bleibt deshalb unbekannt; bei Ausgaben wertet der Abgleich
 * die Steuerart nicht aus (legacyVatByMonth, Vorsteuer Kz 66).
 */
export function fastbillTaxType(t: string): string {
  return `case coalesce(${t}.raw->>'VAT_CASE', '')
        when 'standard' then 'net' when '' then 'net' when '0' then 'net'
        when '1' then 'fastbill:eu'
        when 'small_business_regulation' then 'vatfree'
        when 'b2b_eu_services' then 'externalService13b' when 'b2b_eu_goods' then 'intraCommunitySupply'
        when 'b2b_noneu_goods' then 'thirdPartyCountryDelivery' when 'b2c_noneu_goods' then 'thirdPartyCountryDelivery'
        when 'b2b_noneu_services' then 'thirdPartyCountryService'
        else 'fastbill:' || (${t}.raw->>'VAT_CASE') end`;
}

/** Ausgaben aus FastBill, die noch auf ihren Beleg warten, liegen nicht im Archiv: Solange es sie gibt, ist das Jahr nicht vollständig */
export function fastbillWaitingChecks(waiting: number | undefined): ReconciliationCheck[] {
  if (!waiting) return [];
  return [
    {
      ok: false,
      label: "Keine Ausgabe wartet auf ihren Beleg",
      detail: `${waiting} ${waiting === 1 ? "Ausgabe aus FastBill wartet" : "Ausgaben aus FastBill warten"}`,
    },
  ];
}
