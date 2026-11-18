import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { Route } from "./finanzamt.tsx";

const JAHR = 2026;

/** Erstattungsüberhang gesetzt, damit die Zeile erscheint, um die es geht */
const prognose = {
  year: JAHR,
  einkuenfteArbeit: 4_200_00,
  gesamtbetragEinkuenfte: 5_400_00,
  erstattungsueberhang: 600_00,
  vorsorge: 1_200_00,
  sonderausgaben: 72_00,
  kinderbetreuung: 0,
  aussergewoehnlich: 0,
  zvE: 4_128_00,
  kinderfreibetrag: false,
  tariflich: 900_00,
  ermaessigung35a: 0,
  einkommensteuer: 900_00,
  soli: 0,
  kirchensteuer: 0,
  gesamt: 900_00,
  steuerabzug: 300_00,
  verbleibend: 600_00,
  jeQuartal: 150_00,
};

/** `angabenAus`: Jahr der Angaben zur Einkommensteuer, auf denen die Prognose beruht; null = keine gespeichert */
function fixture(angabenAus: number | null) {
  return {
    company: { name: "Beispielfirma", finanzamt: "Finanzamt Musterstadt", steuernummer: "000/000/00000", iban: "DE00 0000 0000 0000 0000 00" },
    taxAccount: null,
    konten: [],
    person: { vorname: "Max", name: "Mustermann" },
    issues: [],
    bankIssues: [],
    documents: [],
    lastFetch: null,
    pendingConfirmations: { test: 0, live: 0 },
    autoFetch: { enabled: false, lastRun: null, lastError: null },
    basis: {
      year: JAHR,
      until: `${JAHR}-07-02`,
      profitSoFar: 3_000_00,
      profitForecast: 6_000_00,
      profitLastYear: 5_000_00,
      einkunftsart: "selbstaendig" as const,
      prognose,
      angabenAus,
      priorBenefitsOmitted: false,
    },
    messages: [],
    certificate: null,
    mode: "simuliert",
    herstellerIdConfigured: false,
    today: `${JAHR}-07-02`,
  };
}

const render = () => renderToStaticMarkup(createElement(Route.options.component as ComponentType));
const HINWEIS =
  "Zur Kirchensteuer in deinen Angaben gehört auch die einbehaltene Lohnkirchensteuer (in der Lohnsteuerbescheinigung Nr. 6 und 7, bei sonstigen Bezügen Nr. 13 und 14)";

describe("Finanzamt: Hinweis zur Lohnkirchensteuer bei übernommenen Angaben (#1451)", () => {
  beforeEach(() => {
    state.data = fixture(JAHR - 1);
  });

  it("Angaben aus dem Vorjahr: der Hinweis nennt die Lohnkirchensteuer und den Überhang", () => {
    state.data = fixture(JAHR - 1);
    const html = render();
    expect(html).toContain(HINWEIS);
    expect(html).toContain("§ 10 Abs. 4b Satz 3 EStG");
  });

  it("Angaben aus dem laufenden Jahr: kein Hinweis, sie werden nicht übernommen", () => {
    state.data = fixture(JAHR);
    const html = render();
    expect(html).not.toContain(HINWEIS);
    expect(html).not.toContain("Lohnkirchensteuer");
  });

  it("keine Angaben gespeichert: kein Hinweis", () => {
    state.data = fixture(null);
    const html = render();
    expect(html).not.toContain("Lohnkirchensteuer");
    expect(html).toContain("Ohne gespeicherte Angaben zur Einkommensteuer (Vorsorge, Kinder …) rechnet Haben nur mit dem Sonderausgaben-Pauschbetrag.");
  });
});
