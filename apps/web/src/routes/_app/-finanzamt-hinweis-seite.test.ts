import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * #1287: Der Reiter „Vorauszahlungen herabsetzen“ liest den Haken „Keine Einkommensteuer-Vorauszahlungen
 * festgesetzt“. Diese Prüfung geht durch die Seite, nicht nur durch den Text: sie zeigt, dass die Angabe aus den
 * Daten am Reiter ankommt und das Formular trotzdem steht.
 */

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("../../server/functions/finanzamt.ts", () => ({
  disablePostfachAutoFetch: {},
  enablePostfachAutoFetch: {},
  fetchFinanzamtPostfach: {},
  getFinanzamt: {},
  sendFinanzamtBankChange: {},
  sendFinanzamtMessage: {},
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => async () => ({}) }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useLoaderData: () => state.data }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => createElement("a", { href: to }, children),
  useRouter: () => ({ invalidate: async () => {} }),
}));
import type { Basis } from "./-finanzamt-daten.ts";
import { Route } from "./finanzamt.tsx";

/**
 * Zahlen der Schätzrechnung; Nullen genügen, es geht um den Hinweis darüber. Vollständig, weil die Seite jede Zeile
 * der Prognose druckt: fehlt ein Feld, steht im HTML „NaN €" statt eines Betrags.
 */
const basis: Basis = {
  year: 2026,
  until: "2026-11-01",
  profitSoFar: 0,
  profitForecast: 0,
  profitLastYear: 0,
  einkunftsart: "gewerbe",
  angabenAus: null,
  priorBenefitsOmitted: false,
  prognose: {
    year: 2026,
    einkuenfteArbeit: 0,
    gesamtbetragEinkuenfte: 0,
    erstattungsueberhang: 0,
    vorsorge: 0,
    sonderausgaben: 0,
    kinderbetreuung: 0,
    aussergewoehnlich: 0,
    zvE: 0,
    kinderfreibetrag: false,
    tariflich: 0,
    ermaessigung35a: 0,
    einkommensteuer: 0,
    soli: 0,
    kirchensteuer: 0,
    gesamt: 0,
    steuerabzug: 0,
    verbleibend: 0,
    jeQuartal: 0,
  },
};

function fixture(keineVorauszahlungen: boolean) {
  return {
    company: { name: "Mustermann IT", finanzamt: "Finanzamt Regensburg", steuernummer: "198/113/10010", iban: "DE89370400440532013000" },
    taxAccount: null,
    konten: [],
    person: { vorname: "Max", name: "Mustermann" },
    issues: [],
    bankIssues: [],
    documents: [],
    lastFetch: null,
    pendingConfirmations: { test: 0, live: 0 },
    autoFetch: { enabled: false, lastRun: null, lastError: null },
    basis,
    keineVorauszahlungen,
    messages: [],
    certificate: null,
    mode: "simuliert",
    herstellerIdConfigured: false,
    today: "2026-11-14",
  };
}

const render = () => renderToStaticMarkup(createElement(Route.options.component as ComponentType));

describe("Finanzamt: Hinweis bei gesetztem Haken (#1287)", () => {
  beforeEach(() => {
    state.data = fixture(false);
  });

  it("erklärt den Antrag bei gesetztem Haken als gegenstandslos und lässt das Formular stehen", () => {
    state.data = fixture(true);
    const html = render();
    expect(html).toContain("keine Vorauszahlungen festgesetzt");
    expect(html).toContain("gegenstandslos");
    // Kein NaN aus einer unvollständigen Prognose
    expect(html).not.toContain("NaN");
    // Das Formular bleibt erreichbar: die Überschrift des Antrags und der Knopf zum Absenden stehen weiter da
    expect(html).toContain("Einkommensteuer-Vorauszahlungen 2026");
    expect(html).toContain("Prüfen und testweise senden");
  });

  it("zeigt ohne Haken keinen Hinweis", () => {
    expect(render()).not.toContain("gegenstandslos");
  });
});
