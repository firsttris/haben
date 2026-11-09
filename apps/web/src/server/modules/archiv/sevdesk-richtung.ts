import { sql, type SQL } from "drizzle-orm";

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
