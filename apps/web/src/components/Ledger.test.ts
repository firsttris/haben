import { describe, expect, it } from "vitest";
import { vorgangZurHerkunft } from "./Ledger.tsx";

describe("Herkunft einer Buchung öffnet den Vorgang (Journal und Kontenblatt)", () => {
  const buchung = { sourceId: "q1", invoiceId: null, documentId: null };

  it("Rechnung, Beleg und Anlage führen auf ihre Detailseite", () => {
    expect(vorgangZurHerkunft({ ...buchung, sourceType: "invoice" })).toEqual({ to: "/rechnungen/$id", id: "q1" });
    expect(vorgangZurHerkunft({ ...buchung, sourceType: "document" })).toEqual({ to: "/belege/$id", id: "q1" });
    expect(vorgangZurHerkunft({ ...buchung, sourceType: "asset" })).toEqual({ to: "/anlagen/$id", id: "q1" });
  });

  it("Verrechnung führt auf ihre Rechnung bzw. ihren Beleg", () => {
    expect(vorgangZurHerkunft({ ...buchung, sourceType: "verrechnung", invoiceId: "r1" })).toEqual({ to: "/rechnungen/$id", id: "r1" });
    expect(vorgangZurHerkunft({ ...buchung, sourceType: "verrechnung", documentId: "b1" })).toEqual({ to: "/belege/$id", id: "b1" });
  });

  it("Bank, Kasse und Lohn haben keine eigene Detailseite", () => {
    for (const sourceType of ["allocation", "kasse", "lohn", "pauschale", "manuell"]) expect(vorgangZurHerkunft({ ...buchung, sourceType })).toBeNull();
  });
});

describe("Vorsteuerfreigabe zum Leistungsdatum (#693)", () => {
  it("führt auf den Beleg: ihre Quelle ist der Beleg selbst, nicht die Bank", () => {
    expect(vorgangZurHerkunft({ sourceType: "freigabe", sourceId: "b1", invoiceId: null, documentId: null })).toEqual({ to: "/belege/$id", id: "b1" });
  });
});
