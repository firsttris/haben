import { describe, expect, it } from "vitest";
import { invoiceTitle } from "./invoice.ts";

describe("invoiceTitle", () => {
  it("nennt Abschlags- und Schlussrechnung nur bei Rechnungen", () => {
    expect(invoiceTitle("rechnung", null)).toBe("Rechnung");
    expect(invoiceTitle("rechnung", "abschlag")).toBe("Abschlagsrechnung");
    expect(invoiceTitle("storno", "schluss")).toBe("Stornorechnung");
    expect(invoiceTitle("angebot")).toBe("Angebot");
  });
});
