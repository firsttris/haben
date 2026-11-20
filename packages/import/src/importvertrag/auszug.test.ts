import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PSP_FORMATS } from "../types.ts";
import { eventKeyOf, statementFromBatch } from "./auszug.ts";
import { batchSchema } from "./types.ts";

// Erfundene Lieferung, siehe test-fixtures/importvertrag/README.md
const ebay = batchSchema.parse(JSON.parse(readFileSync(new URL("../../test-fixtures/importvertrag/ebay.json", import.meta.url), "utf8")));

describe("statementFromBatch: Auszug aus einer Lieferung (REST-Import, #306)", () => {
  const { statement, eventOf } = statementFromBatch(ebay, "psp");

  it("legt je Bewegung einen Umsatz an, Gebühr getrennt, ohne Netto, im Format eines Zahlungsdienstleisters", () => {
    expect(PSP_FORMATS).toContain(statement.format);
    expect(statement.transactions.map((t) => t.amount)).toEqual([4999, -1006, 2500, -400, -1500, 45, -3995, -643]);
    expect(statement.transactions.reduce((s, t) => s + t.amount, 0)).toBe(0);
    expect(statement).toMatchObject({ currency: "EUR", periodFrom: "2026-10-01", periodTo: "2026-10-31", statedBalance: { date: "2026-10-31", amount: 0 } });
    expect(statement.transactions.map((t) => t.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("ordnet jedem Umsatz seine Bewegung zu, die Gebühr mit eigener Komponente", () => {
    expect(statement.transactions.map(eventOf)).toEqual([
      "SALE-0001",
      "SALE-0001#fee",
      "SALE-0002",
      "SALE-0002#fee",
      "REFUND-0003",
      "REFUND-0003#fee",
      "CHARGE-0004",
      "PAYOUT-0001",
    ]);
    expect(ebay.movements.map(eventKeyOf)).toEqual(statement.transactions.map(eventOf));
  });

  it("kennzeichnet Gebühren, Erstattung und Auszahlung wie die Exporte der Zahlungsdienstleister", () => {
    const [verkauf, gebuehr, , , erstattung, gutschrift, abo, auszahlung] = statement.transactions;
    expect(verkauf).toMatchObject({ purpose: "Bestellung 01-00000-00001", type: "Zahlung", counterpartyName: "Erika Beispiel" });
    // Gebühren erkennt der Abgleich am Verwendungszweck (Sammelrechnung des Dienstleisters)
    expect(gebuehr!.purpose).toBe("Gebühr · Gebühren zu Bestellung 01-00000-00001");
    expect(gutschrift!.purpose).toMatch(/^Gebühr · /);
    expect(abo).toMatchObject({ purpose: "Gebühr · Shop-Abonnement Oktober", type: "Gebühr" });
    // Der Bezug der Erstattung steht im Verwendungszweck; die Bestellung steht schon im gelieferten Text
    expect(erstattung).toMatchObject({ purpose: "Erstattung zu SALE-0001 · Teilerstattung zu Bestellung 01-00000-00001", type: "Erstattung" });
    // Auszahlungen verbindet der Abgleich über „payout-…|“ mit dem Eingang auf der Bank (Geldtransit)
    expect(auszahlung).toMatchObject({
      purpose: "Auszahlung PAYOUT-0001 · Auszahlung auf das Geschäftskonto",
      bankReference: "payout-PAYOUT-0001|PAYOUT-0001",
    });
  });

  it("schreibt die Bestellung dazu, wenn der gelieferte Text sie nicht nennt", () => {
    const [ohne] = statementFromBatch({ ...ebay, movements: [{ ...ebay.movements[0]!, purpose: "Verkauf" }] }, "psp").statement.transactions;
    expect(ohne!.purpose).toBe("Bestellung 01-00000-00001 · Verkauf");
  });

  it("nimmt für ein Bankkonto ein Format, das kein Zahlungsdienstleister ist", () => {
    expect(PSP_FORMATS).not.toContain(statementFromBatch(ebay, "bank").statement.format);
  });
});
