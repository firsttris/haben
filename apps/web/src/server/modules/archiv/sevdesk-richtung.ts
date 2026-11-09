import { SEV_HEAD_RATES, SEV_TEMPORARY_HEAD_RATES } from "@haben/import";
import { sql, type SQL } from "drizzle-orm";
import type { LegacyTaxRow } from "../../db/schema.ts";

/*
 * Richtung und Belegart von sevDesk-Belegen, zur Laufzeit aus der gespeicherten API-Antwort. Frühere Abrufe haben C als
 * Einnahme gespeichert; das Archiv ist nur anhängbar. Die OpenAPI nennt nur „credit (C) or debit (D)“; belegt ist die
 * Bedeutung mit echten Antworten (#472): C trägt Aufwandskonten, D Erlöse und Erstattungen.
 */

function sevdeskVoucher(alias: string) {
  return {
    isVoucher: `${alias}.source = 'sevdesk' and ${alias}.lexoffice_id like 'voucher/%'`,
    income: `upper(coalesce(${alias}.raw->>'creditDebit', 'C')) = 'D'`,
  };
}

export function effectiveDirection(alias: string): SQL<"einnahme" | "ausgabe"> {
  const { isVoucher, income } = sevdeskVoucher(alias);
  return sql.raw(`case when ${isVoucher} then case when ${income} then 'einnahme' else 'ausgabe' end else ${alias}.direction end`) as SQL<
    "einnahme" | "ausgabe"
  >;
}

export function effectiveType(alias: string): SQL<string> {
  const { isVoucher, income } = sevdeskVoucher(alias);
  const kind = (prefix: string) => `case when ${alias}.gross < 0 then '${prefix}creditnote' else '${prefix}invoice' end`;
  return sql.raw(`case when ${isVoucher} then case when ${income} then ${kind("sales")} else ${kind("purchase")} end else ${alias}.type end`) as SQL<string>;
}

/**
 * sevDesk lässt `supplierName` bei den meisten Belegen leer (#472). Dann gilt der Name beim Speichern des Belegs: Er ändert
 * sich nicht, wenn der Kontakt später umbenannt wird. Erst ohne ihn der verknüpfte Kontakt.
 */
export function effectiveContactName(alias: string): SQL<string> {
  return sql.raw(
    `case when ${alias}.source = 'sevdesk' and ${alias}.contact_name = '' then coalesce(nullif(btrim(${alias}.raw->>'supplierNameAtSave'), ''), (select c.name from contacts c where c.id = ${alias}.contact_id), '') else ${alias}.contact_name end`,
  ) as SQL<string>;
}

/**
 * Steuersätze einer Rechnung ohne Positionen: Frühere Abrufe haben Satz 0 gespeichert, obwohl der Kopf Steuer nennt (#472).
 * Wie rateFromHead in @haben/import; `bigint`, weil Netto mal Satz über den Bereich von integer hinausgeht.
 */
export function effectiveTaxes(alias: string): SQL<LegacyTaxRow[]> {
  const distance = `abs(${alias}.net::bigint * head.rate - ${alias}.tax::bigint * 10000)`;
  const fromHead = `(select jsonb_build_array(jsonb_build_object('rate', head.rate, 'net', ${alias}.net, 'tax', ${alias}.tax))
    from unnest(array[${SEV_HEAD_RATES.join(",")}]) with ordinality as head(rate, position)
    where ${distance} <= 10000 order by head.rate = any(array[${SEV_TEMPORARY_HEAD_RATES.join(",")}]), ${distance}, head.position limit 1)`;
  const withoutPositions = `${alias}.source = 'sevdesk' and ${alias}.tax <> 0 and (${alias}.raw->'positions' is null or ${alias}.raw->'positions' = '[]'::jsonb)
    and jsonb_array_length(${alias}.taxes) = 1 and (${alias}.taxes->0->>'rate')::int = 0`;
  return sql.raw(`case when ${withoutPositions} then coalesce(${fromHead}, ${alias}.taxes) else ${alias}.taxes end`) as SQL<LegacyTaxRow[]>;
}
