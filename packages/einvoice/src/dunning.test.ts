import { dunningAmounts } from "@haben/core";
import { describe, expect, it } from "vitest";
import { buildDunningPdf, dunningPdfData } from "./dunning.ts";
import { sampleBuyer, sampleSeller } from "./samples.ts";

const doc = {
  level: 2 as const,
  date: "2026-10-16",
  dueDate: "2026-10-26",
  seller: sampleSeller,
  buyer: sampleBuyer,
  invoice: { number: "2026-034", issueDate: "2026-09-02", dueDate: "2026-09-16" },
  amounts: dunningAmounts({ open: 1_740_958, dueDate: "2026-09-16", date: "2026-10-16", fee: 500, flatFee: true, interestRate: 1_027 }),
  intro: "leider haben wir keinen Zahlungseingang erhalten.",
  closing: "Sollten Sie bereits gezahlt haben, ist dieses Schreiben gegenstandslos.",
};

describe("Mahnung als PDF", () => {
  it("führt Gebühr, Pauschale und Zinsen auf", () => {
    const data = dunningPdfData(doc);
    expect(data.title).toBe("Mahnung");
    expect(data.rows.map((r) => r.label)).toEqual([
      "Offener Rechnungsbetrag",
      "Mahngebühr",
      "Verzugspauschale (§ 288 Abs. 5 BGB)",
      "Verzugszinsen 10,27 % p. a. für 30 Tage",
    ]);
    expect(data.payment).toContain("bis zum 26.10.2026");
    expect(data.payment).toContain("IBAN DE89 3704 0044 0532 0130 00");
  });

  it("erzeugt ein PDF", () => {
    const pdf = buildDunningPdf(doc);
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });
});
