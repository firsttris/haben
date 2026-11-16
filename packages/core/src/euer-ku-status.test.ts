import { describe, expect, it } from "vitest";
import { computeEuer } from "./euer.ts";
import { computeInvoiceTotals } from "./invoice.ts";
import { euerAusZeilen } from "./journal-euer.ts";
import { invoicePosting } from "./posting.ts";
import type { TaxTreatment } from "./treatment.ts";

// Amtliche Anleitung EÜR 2025, Zeilen 12/13: vollständige KU-Einnahmen; die Nachricht verändert den Gewinn nicht.
// https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2025
const totals = computeInvoiceTotals([{ quantity: 1000, unitPrice: 100_00, taxRate: 0 }]);
const treatments: TaxTreatment[] = ["steuerfrei", "drittland", "reverse_charge", "eu_sonstige", "ig_lieferung", "ausfuhr", "regulaer"];
const betrag = (euer: ReturnType<typeof computeEuer>, key: string) => euer.einnahmen.find((line) => line.key === key)?.amount ?? 0;

describe("EÜR-Zeile 12 nach Kleinunternehmerstatus", () => {
  it.each(treatments)("%s: KU im Zahlungsmonat, beide Kontenrahmen und Ist/Soll", (treatment) => {
    const payments = [{ kind: "invoice" as const, date: "2026-10-10", paid: 100_00, totals, treatment }];
    const nebenbuch = computeEuer(2026, payments, undefined, undefined, Array(12).fill(true));
    expect(betrag(nebenbuch, "einnahmenKleinunternehmer")).toBe(100_00);
    expect(betrag(nebenbuch, "einnahmenSteuerfrei")).toBe(0);
    expect(nebenbuch.gewinn).toBe(100_00);
    expect(nebenbuch.monthly.einnahmen[9]).toBe(100_00);
    for (const [kr, taxation] of [
      ["SKR03", "ist"],
      ["SKR04", "soll"],
    ] as const) {
      const journal = euerAusZeilen(kr, invoicePosting(totals, kr, taxation, treatment), "sonst", undefined, true);
      expect(journal.zeilen.einnahmenKleinunternehmer).toBe(100_00);
      expect(journal.zeilen.einnahmenSteuerfrei ?? 0).toBe(0);
    }
  });

  it("Statuswechsel: nur der KU-Monat steht in Zeile 12; Regelbesteuerung behält Zeile 16", () => {
    const euer = computeEuer(
      2026,
      [
        { kind: "invoice", date: "2026-01-20", paid: 30_00, totals, treatment: "steuerfrei" },
        { kind: "invoice", date: "2026-02-20", paid: 70_00, totals, treatment: "steuerfrei" },
      ],
      undefined,
      undefined,
      [true, false],
    );
    expect(betrag(euer, "einnahmenKleinunternehmer")).toBe(30_00);
    expect(betrag(euer, "einnahmenSteuerfrei")).toBe(70_00);
    expect(euer.gewinn).toBe(100_00);
  });

  it("Rechnung aus der Regelbesteuerung behält auch beim späteren KU-Zufluss Netto und Umsatzsteuer", () => {
    const tax = computeInvoiceTotals([{ quantity: 1000, unitPrice: 100_00, taxRate: 1900 }]);
    const euer = computeEuer(
      2026,
      [{ kind: "invoice", date: "2026-10-10", paid: 119_00, totals: tax, treatment: "regulaer" }],
      undefined,
      undefined,
      Array(12).fill(true),
    );
    expect(betrag(euer, "einnahmenSteuerpflichtig")).toBe(100_00);
    expect(betrag(euer, "vereinnahmteUst")).toBe(19_00);
    expect(betrag(euer, "einnahmenKleinunternehmer")).toBe(0);
  });
});
