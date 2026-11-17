import { sql } from "drizzle-orm";

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

/**
 * Steuerart aus der gespeicherten API-Antwort, in den Werten von Lexoffice. Lexoffice: Rechnungsmodul unter taxConditions,
 * Buchhaltungsbelege direkt. sevDesk: Steuerregel (Update 2.0), sonst die ältere taxType; Reverse Charge (Regel 5)
 * lässt sich nicht eindeutig einer Kennzahl zuordnen und bleibt unbekannt. Regel 17 „Nicht im Inland steuerbare Leistung“
 * bucht sevDesk im DATEV-Export auf SKR03 8338 (Drittland) und zählt wie FastBill b2b_noneu_services in Kz 45, Regel 21
 * „Reverse Charge gem. § 18b UStG“ wie b2b_eu_services in Kz 21 (#472, Daten aus Version 2.0); eine eigene Steuerart (taxType custom) ordnet
 * sevdesk-steuerarten.ts über ihre Kennzahlen zu. FastBill: VAT_CASE.
 */
export function taxTypeOf(t: string) {
  return sql.raw(`case when ${t}.source = 'fastbill' then ${fastbillTaxType(t)}
    when ${t}.source = 'sevdesk' then
      case coalesce(${t}.raw->'taxRule'->>'id', '')
        when '1' then 'net' when '2' then 'thirdPartyCountryDelivery' when '3' then 'intraCommunitySupply'
        when '4' then 'vatfree' when '11' then 'vatfree'
        when '17' then 'thirdPartyCountryService' when '21' then 'externalService13b'
        when '' then case coalesce(${t}.raw->>'taxType', 'default')
          when 'default' then 'net' when 'eu' then 'intraCommunitySupply' when 'ss' then 'vatfree'
          else 'sevdesk:' || (${t}.raw->>'taxType') end
        else 'sevdesk:taxRule' || (${t}.raw->'taxRule'->>'id') end
    else coalesce(${t}.raw->'taxConditions'->>'taxType', ${t}.raw->>'taxType') end`);
}
