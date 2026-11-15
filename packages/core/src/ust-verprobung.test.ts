import { describe, expect, it } from "vitest";
import { totalsFromTaxes } from "./invoice.ts";
import { documentPosting, invoicePaymentPosting, invoicePosting, ACCOUNTS, type Kontenrahmen } from "./posting.ts";
import { verprobeBuchung } from "./ust-verprobung.ts";

const rechnung = totalsFromTaxes([
  { rate: 1900, base: 100_00, tax: 19_00 },
  { rate: 700, base: 33_33, tax: 2_33 },
]);

describe.each(["SKR03", "SKR04"] as const)("Umsatzsteuer-Verprobung %s", (kr: Kontenrahmen) => {
  it("Rechnung bei Soll, Rechnung und Zahlung bei Ist stimmen", () => {
    expect(verprobeBuchung(kr, "soll", invoicePosting(rechnung, kr, "soll"))).toEqual([]);
    expect(verprobeBuchung(kr, "ist", invoicePosting(rechnung, kr, "ist"))).toEqual([]);
    // Teilzahlung: Anteil je Satz gerundet, innerhalb eines Cents
    expect(verprobeBuchung(kr, "ist", invoicePaymentPosting(rechnung, 50_00, kr, "ist"))).toEqual([]);
  });

  it("Beleg mit Vorsteuer und mit Privatanteil stimmt", () => {
    const beleg = totalsFromTaxes([{ rate: 1900, base: 1_000_00, tax: 190_00 }]);
    expect(verprobeBuchung(kr, "soll", documentPosting(beleg, "buero", kr, "einzelunternehmen", "bank"))).toEqual([]);
    expect(verprobeBuchung(kr, "ist", documentPosting(beleg, "telefon", kr, "einzelunternehmen", "bank", true, undefined, 33))).toEqual([]);
  });

  it("findet eine Steuer, die nicht zur Bemessungsgrundlage passt", () => {
    const zeilen = invoicePosting(rechnung, kr, "soll").map((z) =>
      z.account === ACCOUNTS[kr].ust[1900] ? { ...z, credit: z.credit + 5 } : z.account === ACCOUNTS[kr].forderungen ? { ...z, debit: z.debit + 5 } : z,
    );
    expect(verprobeBuchung(kr, "soll", zeilen)).toEqual([{ satz: 1900, art: "umsatzsteuer", bemessung: 100_00, steuer: 19_05, erwartet: 19_00 }]);
    const beleg = documentPosting(totalsFromTaxes([{ rate: 700, base: 10_00, tax: 70 }]), "buero", kr, "einzelunternehmen", "bank").map((z) =>
      z.account === ACCOUNTS[kr].vorsteuer[700] ? { ...z, debit: 1_70 } : z,
    );
    expect(verprobeBuchung(kr, "soll", beleg)).toEqual([{ satz: 700, art: "vorsteuer", bemessung: 10_00, steuer: 1_70, erwartet: 70 }]);
  });

  it("ein Cent Rundung je Buchung und Satz ist erlaubt, zwei nicht", () => {
    const um = (cent: number) =>
      invoicePosting(rechnung, kr, "soll").map((z) =>
        z.account === ACCOUNTS[kr].ust[700] ? { ...z, credit: z.credit + cent } : z.account === ACCOUNTS[kr].forderungen ? { ...z, debit: z.debit + cent } : z,
      );
    expect(verprobeBuchung(kr, "soll", um(1))).toEqual([]);
    expect(verprobeBuchung(kr, "soll", um(2))).toHaveLength(1);
  });
});
