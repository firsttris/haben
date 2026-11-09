import { describe, expect, it } from "vitest";
import belege from "../../test-fixtures/sevdesk/buchhaltung-1.0/belege-credit-debit.json" with { type: "json" };
import stornoV1 from "../../test-fixtures/sevdesk/buchhaltung-1.0/storno-paar.json" with { type: "json" };
import stornoV2 from "../../test-fixtures/sevdesk/buchhaltung-2.0/storno-paar.json" with { type: "json" };
import { mapSevInvoice, mapSevVoucher } from "./map.ts";
import { sevInvoiceSchema, sevVoucherSchema } from "./types.ts";

/* Anonymisierte echte Antworten je Buchhaltungsversion; weicht eine Version ab, fällt es hier auf (#472). */

describe.each([
  ["1.0", stornoV1],
  ["2.0", stornoV2],
])("Stornorechnung in Buchhaltungsversion %s", (_version, paar) => {
  const original = mapSevInvoice(sevInvoiceSchema.parse(paar.original_storniert.invoice), []);
  const storno = mapSevInvoice(sevInvoiceSchema.parse(paar.stornorechnung.invoice), []);

  it("führt die Rechnung und ihr Storno als gegengleiche Beträge", () => {
    expect(original.voucher.type).toBe("invoice");
    expect(original.voucher.gross).toBeGreaterThan(0);
    expect(storno.voucher).toMatchObject({ type: "creditnote", direction: "einnahme", gross: -original.voucher.gross });
  });

  it("verweist mit origin vom Storno auf die Rechnung", () => {
    const { origin } = paar.stornorechnung.invoice as { origin: { id: string; objectName: string } };
    expect(origin).toMatchObject({ id: paar.original_storniert.invoice.id, objectName: "Invoice" });
  });

  it("nennt beide bezahlt, obwohl keine Zahlung floss", () => {
    for (const { invoice } of [paar.original_storniert, paar.stornorechnung]) {
      expect(invoice.status).toBe("1000");
      expect(Number(invoice.paidAmount)).toBe(0);
      expect(invoice.payDate).toBeNull();
    }
  });
});

describe("Belegrichtung in Buchhaltungsversion 1.0", () => {
  it.each(belege.map((b) => [b.positions[0]!.accountingType.name, b] as const))("%s", (_konto, beleg) => {
    const { voucher } = mapSevVoucher(sevVoucherSchema.parse(beleg.voucher), beleg.positions);
    expect(voucher.direction).toBe(beleg.voucher.creditDebit === "C" ? "ausgabe" : "einnahme");
  });

  it("trägt bei D Erlöse und bei C Aufwand", () => {
    const konten = (seite: string) => belege.filter((b) => b.voucher.creditDebit === seite).map((b) => b.positions[0]!.accountingType.name);
    expect(konten("D")).toContain("Einnahmen / Erlöse / Verkäufe");
    expect(konten("C")).toContain("Benzin");
  });
});
