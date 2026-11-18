import { gzipSync, strToU8 } from "fflate";

/*
 * Finanzbericht FINANCE_DETAIL (Z1) von App Store Connect im Aufbau echter Berichte (#1424), Inhalt erfunden: Vorspann
 * mit dem Zeitraum, Kopfzeile ab „Transaction Date“, Vorgänge, Summenblock je Land und Währung. Der Zeitraum ist Apples
 * Fiskalperiode 2027-01, also der Oktober 2026.
 */

/** Periode, unter der Apple den Bericht ausliefert (filter[reportDate]) */
export const APPLE_TEST_PERIOD = "2027-01";

const HEADER =
  "Transaction Date\tSettlement Date\tApple Identifier\tSKU\tTitle\tDeveloper Name\tProduct Type Identifier\tCountry of Sale\tQuantity\tPartner Share\tExtended Partner Share\tPartner Share Currency\tCustomer Price\tCustomer Currency\tSale or Return\tPromo Code\tOrder Type\tRegion";

/** Je Vorgang Extended Partner Share, Währung und S (Verkauf) oder R (Rückgabe) */
export function appleFinanceReport(rows: [amount: string, currency: string, saleOrReturn?: "S" | "R"][]): Uint8Array {
  const sums = new Map<string, number>();
  // Beträge mit zwei Nachkommastellen, in Cent ohne Gleitkomma
  for (const [amount, currency] of rows) sums.set(currency, (sums.get(currency) ?? 0) + Number(amount.replace(".", "")));
  return gzipSync(
    strToU8(
      [
        "Vendor Name\tMuster Apps",
        "Start Date\t09/28/2026",
        "End Date\t11/01/2026",
        HEADER,
        ...rows.map(
          ([amount, currency, kind = "S"]) =>
            `10/05/2026\t10/06/2026\t1234567890\tpro\tPro-Version\tMuster Apps\t1F\tDE\t${kind === "R" ? -1 : 1}\t${amount.replace("-", "")}\t${amount}\t${currency}\t4.990\t${currency}\t${kind}\t\t\t\t`,
        ),
        "Country Of Sale\tPartner Share Currency\tQuantity\tExtended Partner Share",
        ...[...sums].map(([currency, cents]) => `DE\t${currency}\t1\t${cents < 0 ? "-" : ""}${Math.trunc(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`),
        "",
      ].join("\n"),
    ),
  );
}
