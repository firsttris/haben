import { describe, expect, it } from "vitest";
import { legacyVatByMonth, type LegacyVatFields, type LegacyVatVoucher } from "./legacy-vat.ts";

/*
 * Eigene Steuerarten aus sevDesk (taxType custom, Kennzahlen aus GET /TaxSet) im Abgleich je Monat (#472). Die Steuerarten
 * sind erfunden, gebaut wie die echten Antworten: Satz, Kennzahl der Bemessungsgrundlage, Kennzahlen der Steuer.
 */

const RC_DRITTLAND: LegacyVatFields = { rate: 1900, net: "46", tax: ["47", "67"] };
const ERWERB: LegacyVatFields = { rate: 1900, net: "89", tax: ["61"] };
const KLEINUNTERNEHMER: LegacyVatFields = { rate: 0, net: null, tax: [] };

function voucher(
  direction: LegacyVatVoucher["direction"],
  date: string,
  net: number,
  vatFields: LegacyVatFields | null,
  extra: Partial<LegacyVatVoucher> = {},
): LegacyVatVoucher {
  return {
    direction,
    date,
    net,
    tax: 0,
    gross: net,
    taxes: [{ rate: 0, net, tax: 0 }],
    payments: [{ date: "2026-06-10", amount: net }],
    taxType: "sevdesk:custom",
    vatFields,
    ...extra,
  };
}

describe("legacyVatByMonth mit eigener Steuerart", () => {
  it("bucht § 13b-Bezüge in Kz 46, die Steuer je Beleg in Kz 47 und 67, nicht in Kz 66", () => {
    const [month] = legacyVatByMonth(
      [
        voucher("ausgabe", "2026-04-03", 2_150, RC_DRITTLAND),
        voucher("ausgabe", "2026-04-17", 1_337, RC_DRITTLAND),
        // Steuer im Beleg, wie sevDesk sie bei einzelnen Belegen dieser Art speichert: zählt nicht als Vorsteuer Kz 66
        voucher("ausgabe", "2026-04-20", 419, RC_DRITTLAND, { tax: 80, gross: 499 }),
      ],
      "ist",
    );
    // 2150 × 19 % = 408,5 → 409; 1337 × 19 % = 254,03 → 254; 419 × 19 % = 79,61 → 80: je Beleg gerundet, Summe 743 (aus der Summe wären es 742)
    expect(month).toMatchObject({ month: "2026-04", kz46: 3_906, kz47: 743, kz67: 743, kz66: 0, otherPurchases: 0, otherBase: 0 });
  });

  it("bucht den innergemeinschaftlichen Erwerb in Kz 89 und die Vorsteuer in Kz 61", () => {
    const [month] = legacyVatByMonth([voucher("ausgabe", "2026-05-08", 10_000, ERWERB)], "soll");
    expect(month).toMatchObject({ kz89: 10_000, kz61: 1_900, kz47: 0, kz67: 0, kz66: 0 });
  });

  it("mindert die Kennzahlen bei einer Gutschrift des Lieferanten", () => {
    const [month] = legacyVatByMonth([voucher("ausgabe", "2026-05-08", 5_000, RC_DRITTLAND), voucher("ausgabe", "2026-05-20", -1_000, RC_DRITTLAND)], "soll");
    expect(month).toMatchObject({ kz46: 4_000, kz47: 950 - 190, kz67: 950 - 190 });
  });

  it("lässt Bezüge ohne Kennzahl (§ 19 UStG) aus der Voranmeldung, mit ihrer Vorsteuer in Kz 66", () => {
    const [month] = legacyVatByMonth([voucher("ausgabe", "2026-05-08", 3_000, KLEINUNTERNEHMER)], "soll");
    expect(month).toMatchObject({ kz46: 0, kz66: 0, otherPurchases: 0 });
  });

  it("zeigt Bezüge ohne abgerufene Steuerart oder mit unbekannter Kennzahl getrennt, die Steuer wie bisher in Kz 66", () => {
    const [month] = legacyVatByMonth(
      [
        voucher("ausgabe", "2026-05-08", 3_000, null),
        voucher("ausgabe", "2026-05-09", 2_000, { rate: 1900, net: "52", tax: ["53", "67"] }),
        voucher("ausgabe", "2026-05-10", 1_000, { rate: 1900, net: "46", tax: ["47", "99"] }, { tax: 190, gross: 1_190 }),
      ],
      "soll",
    );
    expect(month).toMatchObject({ otherPurchases: 6_000, kz66: 190, kz46: 0, kz47: 0, kz67: 0 });
  });

  it("ordnet Einnahmen nach der Kennzahl der Bemessungsgrundlage zu, § 13b und EU-Lieferung nach Belegdatum auch bei Ist", () => {
    const months = legacyVatByMonth(
      [
        voucher("einnahme", "2026-05-08", 4_000, { rate: 0, net: "60", tax: [] }),
        voucher("einnahme", "2026-05-09", 3_000, { rate: 0, net: "21", tax: [] }),
        voucher("einnahme", "2026-05-10", 2_000, { rate: 0, net: "41", tax: [] }),
        // Ausfuhr zählt bei Ist nach Zahlung (10. Juni)
        voucher("einnahme", "2026-05-11", 1_000, { rate: 0, net: "43", tax: [] }),
        voucher("einnahme", "2026-05-12", 500, KLEINUNTERNEHMER),
      ],
      "ist",
    );
    expect(months).toEqual([
      expect.objectContaining({ month: "2026-05", kz60: 4_000, kz21: 3_000, kz41: 2_000, kz43: 0, steuerfrei: 0, otherBase: 0 }),
      expect.objectContaining({ month: "2026-06", kz43: 1_000, steuerfrei: 500, otherBase: 0 }),
    ]);
  });

  it("bucht Einnahmen ohne abgerufene Steuerart oder mit Steuerkennzahl unter „Andere Sätze“", () => {
    const [month] = legacyVatByMonth(
      [
        voucher("einnahme", "2026-05-08", 4_000, null),
        voucher("einnahme", "2026-05-09", 1_000, RC_DRITTLAND),
        voucher("einnahme", "2026-05-10", 700, { rate: 0, net: "99", tax: [] }),
      ],
      "soll",
    );
    expect(month).toMatchObject({ otherBase: 5_700, kz46: 0, kz47: 0, kz81: 0 });
  });

  it("rechnet eine Einnahme mit eigener Steuerart auf Kz 81 wie eine reguläre, bei Ist nach Zahlung", () => {
    const months = legacyVatByMonth(
      [
        voucher(
          "einnahme",
          "2026-05-08",
          10_000,
          { rate: 1900, net: "81", tax: [] },
          { tax: 1_900, gross: 11_900, taxes: [{ rate: 1900, net: 10_000, tax: 1_900 }], payments: [{ date: "2026-06-10", amount: 11_900 }] },
        ),
      ],
      "ist",
    );
    expect(months).toEqual([expect.objectContaining({ month: "2026-06", kz81: 10_000, tax81: 1_900 })]);
  });
});
