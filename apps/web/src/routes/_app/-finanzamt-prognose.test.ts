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

/** Alle Zeilen der Tabelle gefüllt: Erstattungsüberhang, Arbeitslohn und Lohnsteuer erscheinen nur über null. */
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

/**
 * `angabenAus` ist das Jahr der Angaben zur Einkommensteuer, auf denen die Prognose beruht; null = keine gespeichert.
 * `aenderung` überschreibt einzelne Beträge der Prognose (etwa `einkuenfteArbeit: 0` für Freiberufler ohne Lohn).
 */
function fixture(angabenAus: number | null, aenderung: Partial<typeof prognose> = {}) {
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
      prognose: { ...prognose, ...aenderung },
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
/** Wie oft der Zusatz „ (Angaben <jahr>)“ im gerenderten HTML steht */
const zusatz = (html: string, jahr: number) => html.split(` (Angaben ${jahr})`).length - 1;
const HINWEIS =
  "Zur Kirchensteuer in deinen Angaben gehört auch die einbehaltene Lohnkirchensteuer (in der Lohnsteuerbescheinigung Nr. 6 und 7, bis 2024 bei sonstigen Bezügen auch Nr. 13 und 14)";

describe("Finanzamt: Voraussichtliche Steuer nennt das Jahr der Angaben (#1449)", () => {
  beforeEach(() => {
    state.data = fixture(JAHR - 1);
  });

  it("Angaben aus einem früheren Jahr: die vier übernommenen Zeilen tragen das Jahr, der Gewinn nicht", () => {
    state.data = fixture(2025);
    const html = render();
    expect(zusatz(html, 2025)).toBe(4);
    expect(html).toContain('<th scope="row">Erstattungsüberhang (§ 10 Abs. 4b Satz 3 EStG) (Angaben 2025)</th>');
    expect(html).toContain('<th scope="row">Arbeitslohn nach Werbungskosten (Angaben 2025)</th>');
    expect(html).toContain('<th scope="row">Vorsorge, Sonderausgaben, Kinderbetreuung, Belastungen (Angaben 2025)</th>');
    expect(html).toContain('<th scope="row">Lohnsteuer, angerechnet (Angaben 2025)</th>');
    expect(html).toContain('<th scope="row">Hochgerechneter Gewinn</th>');
  });

  it("Angaben aus dem laufenden Jahr: kein Zusatz", () => {
    state.data = fixture(JAHR);
    const html = render();
    expect(zusatz(html, JAHR)).toBe(0);
    expect(html).not.toContain(" (Angaben ");
    expect(html).toContain('<th scope="row">Arbeitslohn nach Werbungskosten</th>');
  });

  it("keine Angaben gespeichert: kein Zusatz, die Fußzeile bleibt wie sie ist", () => {
    state.data = fixture(null);
    const html = render();
    expect(html).not.toContain(" (Angaben ");
    expect(html).toContain("Ohne gespeicherte Angaben zur Einkommensteuer (Vorsorge, Kinder …) rechnet Haben nur mit dem Sonderausgaben-Pauschbetrag.");
  });
});

describe("Finanzamt: Schätzrechnung zugeklappt (#1253)", () => {
  it("steht zu, nennt die Vorauszahlung je Termin in der Überschrift und lässt Tabellen und Formular im Dokument", () => {
    state.data = fixture(JAHR);
    const html = render();
    const details = /<details id="schaetzung"[^>]*>(.*?)<\/details>/s.exec(html);
    expect(details?.[0]).not.toMatch(/^<details[^>]*\sopen/);
    expect(details?.[1]).toContain("Schätzrechnung 2026");
    expect(details?.[1]).toMatch(/Vorauszahlung je Termin 150,00\s€/);
    expect(details?.[1]).toContain("Hochgerechnet auf 2026");
    // Die Warnhinweise zur Schätzung und das Antragsformular bleiben vorn
    expect(html.indexOf("Eine Schätzung, keine")).toBeGreaterThan(html.indexOf("</details>"));
    expect(html).toContain("Gewünschte Vorauszahlung je Quartal (€)");
  });
});

describe("Finanzamt: Hinweis zur Lohnkirchensteuer unter der Prognose (#1451)", () => {
  beforeEach(() => {
    state.data = fixture(JAHR - 1);
  });

  it("Angaben aus dem Vorjahr mit Arbeitslohn: der Hinweis nennt die Lohnkirchensteuer und den Überhang", () => {
    state.data = fixture(JAHR - 1);
    const html = render();
    expect(html).toContain(HINWEIS);
    expect(html).toContain("§ 10 Abs. 4b Satz 3 EStG");
  });

  it("Angaben aus dem Vorjahr ohne Arbeitslohn: kein Hinweis, Lohnkirchensteuer gibt es dort nicht", () => {
    state.data = fixture(JAHR - 1, { einkuenfteArbeit: 0 });
    const html = render();
    expect(html).not.toContain("Lohnkirchensteuer");
    // Die Prognose übernimmt die Angaben trotzdem; der Jahres-Zusatz bleibt an den übrigen Zeilen
    expect(zusatz(html, JAHR - 1)).toBe(3);
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
