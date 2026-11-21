import { describe, expect, it } from "vitest";
import { kindHint } from "./-kasse-hinweis.ts";

describe("kindHint", () => {
  it("nennt für Bareinnahmen und Rechnungen die Buchung, gleich für jede Rechtsform", () => {
    for (const rechtsform of ["einzelunternehmen", "gmbh"] as const) {
      expect(kindHint("einnahme", rechtsform)).toContain("Kasse an Erlöse");
      expect(kindHint("rechnung", rechtsform)).toContain("Kasse an Forderungen");
    }
  });

  it("bucht Abhebung und Einzahlung über Geldtransit, auch bei der GmbH", () => {
    for (const kind of ["abhebung", "einzahlung"] as const) {
      expect(kindHint(kind, "einzelunternehmen")).toContain("Geldtransit");
      expect(kindHint(kind, "gmbh")).toContain("Geldtransit");
    }
  });

  it("nennt bei Einlage und Entnahme das private Geld, bei der GmbH das Verrechnungskonto des Gesellschafters", () => {
    expect(kindHint("einlage", "einzelunternehmen")).toContain("Privates Geld in die Kasse");
    expect(kindHint("entnahme", "einzelunternehmen")).toBe("Geld aus der Kasse für private Zwecke.");
    expect(kindHint("einlage", "gmbh")).toContain("Gesellschafter-Verrechnungskonto");
    expect(kindHint("entnahme", "gmbh")).toContain("Gesellschafter-Verrechnungskonto");
  });
});
