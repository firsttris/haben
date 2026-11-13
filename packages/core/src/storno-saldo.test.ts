import { describe, expect, it } from "vitest";
import { cancellationCustomerBalance } from "./storno-saldo.ts";

describe("Rechnerischer Kundensaldo nach vollständigem Storno", () => {
  it("hebt auch eine unbezahlte Korrektur auf, statt einen Zwischenstand einzufrieren", () => {
    const rows = [
      { id: "rechnung", contactId: "kunde", paid: 100, open: 0 },
      { id: "korrektur", contactId: "kunde", paid: 0, open: -20 },
      { id: "andere", contactId: "kunde", paid: 0, open: 110 },
    ];
    expect(cancellationCustomerBalance(rows, "kunde", ["rechnung", "korrektur"])).toBe(10);
  });

  it("berücksichtigt schon ausgezahlte Korrekturen, weitere Guthaben und dieselbe Kontakt-ID", () => {
    const rows = [
      { id: "rechnung", contactId: "kunde", paid: 100, open: 0 },
      { id: "korrektur", contactId: "kunde", paid: -20, open: 0 },
      { id: "guthaben", contactId: "kunde", paid: 0, open: -10 },
      { id: "fremd", contactId: "anderer", paid: 0, open: 1000 },
    ];
    expect(cancellationCustomerBalance(rows, "kunde", ["rechnung", "korrektur"])).toBe(-90);
  });

  it.each([null, "anderer"])("bleibt ohne passende Identität %s unbekannt", (contactId) => {
    expect(cancellationCustomerBalance([{ id: "rechnung", contactId: "kunde", paid: 0, open: 100 }], contactId, ["rechnung"])).toBeUndefined();
  });

  it("bleibt ohne vollständige Zielposten unbekannt", () => {
    const rows = [{ id: "rechnung", contactId: "kunde", paid: 0, open: 100 }];
    expect(cancellationCustomerBalance(rows, "kunde", ["rechnung", "fehlt"])).toBeUndefined();
    expect(cancellationCustomerBalance(rows, "kunde", [])).toBeUndefined();
  });
});
