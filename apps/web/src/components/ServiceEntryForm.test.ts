import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Die Formulare brauchen Router und Serverfunktionen erst beim Absenden
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate: async () => {} }), useNavigate: () => async () => {} }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => async () => ({}) }));
vi.mock("../server/functions/leistungen.ts", () => ({ saveServiceEntry: () => {}, billEntries: () => {}, getBillingPreview: () => {} }));

import { ServiceBillingForm } from "./ServiceBillingForm.tsx";
import { ServiceEntryForm } from "./ServiceEntryForm.tsx";

const aktiv = { id: "00000000-0000-4000-8000-000000000001", name: "Rheinpixel GmbH", hourlyRateCents: 9500, inactive: false };
const archiviert = { id: "00000000-0000-4000-8000-000000000002", name: "Altkunde GmbH", hourlyRateCents: 8000, inactive: true };
const customers = [aktiv, archiviert];

/** Die Option, die das Select des Kunden gewählt zeigt; null, wenn keine (dann wählt der Browser die erste angebotene) */
function gewaehlt(html: string): string | null {
  const select = html.slice(html.indexOf("<select"), html.indexOf("</select>"));
  return /<option value="([^"]*)"[^>]*selected=""/.exec(select)?.[1] ?? null;
}

const eintrag = (defaultContactId: string) =>
  renderToStaticMarkup(createElement(ServiceEntryForm, { entry: null, customers, today: "2026-11-20", defaultContactId, onDone: () => {} }));
const abrechnen = (defaultContactId: string) =>
  renderToStaticMarkup(createElement(ServiceBillingForm, { customers, today: "2026-11-20", defaultContactId, onClose: () => {} }));

describe("Vorauswahl des Kunden aus ?kunde= (#1557)", () => {
  it("ein aktiver Kunde ist in „Neuer Eintrag“ und „Abrechnen“ gewählt", () => {
    expect(gewaehlt(eintrag(aktiv.id))).toBe(aktiv.id);
    expect(gewaehlt(abrechnen(aktiv.id))).toBe(aktiv.id);
  });

  it("ein archivierter Kunde oder reiner Lieferant wird nicht angeboten, also auch nicht still vorgewählt: „Kunde wählen“", () => {
    // Sonst zeigt das Select den ersten aktiven Kunden, gespeichert oder abgerechnet würde aber für den archivierten
    expect(gewaehlt(eintrag(archiviert.id))).toBe("");
    expect(gewaehlt(abrechnen(archiviert.id))).toBe("");
  });
});
