import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GesamtumsatzResult } from "../server/modules/auswertungen/index.ts";
import { Gesamtumsatz } from "./Gesamtumsatz.tsx";

const known: GesamtumsatzResult["items"][number] = {
  source: "bank",
  sourceId: "known",
  label: "Belegte Zahlung",
  gross: 12_345,
  net: 12_345,
  occurredOn: "2026-09-01",
  basisSource: "stored",
  classification: { kind: "domestic" },
  decision: "included",
  reason: "Inländisches Entgelt",
};
const unknown: GesamtumsatzResult["items"][number] = {
  source: "legacy",
  sourceId: "unknown",
  label: "Ungeklärter Altstand",
  gross: null,
  net: null,
  occurredOn: null,
  basisSource: "unknown",
  classification: null,
  decision: "unknown",
  reason: "Betrag und Zahlungstag nicht belegt",
};
const render = (result: GesamtumsatzResult) => renderToStaticMarkup(createElement(Gesamtumsatz, { result }));

describe("Gesamtumsatz mit Quellenlücken", () => {
  it("stellt eine unvollständige Grundlage als Teilbetrag dar und verschweigt die Lücke nicht", () => {
    const html = render({ year: 2026, included: 12_345, complete: false, items: [known, unknown] });
    expect(html).toContain("Bekannter Teilbetrag");
    expect(html).not.toContain("Ermittelter Betrag");
    expect(html).toContain("Ungeklärter Altstand");
    expect(html).toContain("Betrag und Zahlungstag nicht belegt");
    expect(html).not.toContain("0,00");
  });

  it("zeigt bei vollständig zugeordneten Quellen den ermittelten Betrag", () => {
    const html = render({ year: 2026, included: 12_345, complete: true, items: [known] });
    expect(html).toContain("Ermittelter Betrag");
    expect(html).not.toContain("Bekannter Teilbetrag");
    expect(html).toContain("Belegte Zahlung");
  });

  it("unterscheidet eine leere bekannte Grundlage von ungeklärten Beträgen", () => {
    const html = render({ year: 2026, included: 0, complete: true, items: [] });
    expect(html).toContain("Ermittelter Betrag");
    expect(html).toContain("Keine Quellen mit dieser Einordnung.");
    expect(html).not.toContain("Werte sind im Teilbetrag noch nicht enthalten");
  });
});
