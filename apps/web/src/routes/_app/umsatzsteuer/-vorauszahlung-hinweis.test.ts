import { computeUstva } from "@haben/core";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Route } from "./$zeitraum.tsx";

vi.mock("@tanstack/react-router", async (original) => {
  const router = await original<typeof import("@tanstack/react-router")>();
  const { createElement } = await import("react");
  return {
    ...router,
    useNavigate: () => vi.fn(),
    useRouter: () => ({ invalidate: vi.fn() }),
    Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
  };
});
vi.mock("@tanstack/react-start", async (original) => ({
  ...(await original<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("../../../server/functions/vat.ts", () =>
  Object.fromEntries(
    [
      "getVatPeriod",
      "getMeinElsterUstvaWerte",
      "saveVatDraft",
      "createVatCorrection",
      "submitVatReturn",
      "saveVatFrequency",
      "saveVatDauerfrist",
      "submitVatDauerfrist",
      "fileVatReturnElsewhere",
    ].map((name) => [name, vi.fn()]),
  ),
);
// Diese beiden unabhängigen Einstellkarten gehören nicht zur Kennzahlen-/Berichtigungsanzeige.
vi.mock("../../../components/umsatzsteuer/VatFrequencyCard.tsx", () => ({ VatFrequencyCard: () => null }));
vi.mock("../../../components/umsatzsteuer/DauerfristCard.tsx", () => ({ DauerfristCard: () => null }));

describe("Hinweis nach nachträglicher Vorauszahlungszuordnung", () => {
  it("erhält die gesendeten Nullwerte und nennt aktuelle 700 € Bemessung sowie den Berichtigungsweg", () => {
    const zero = computeUstva({ kz81: 0, kz86: 0, kz66: 0 });
    const current = {
      ...zero,
      id: "alte-anmeldung",
      source: "berechnet",
      computed: zero,
      status: "sent",
      berichtigt: false,
      sentAt: new Date("2026-01-10T12:00:00Z"),
      updatedAt: new Date("2026-01-10T12:00:00Z"),
    };
    const data = {
      period: { year: 2025, month: 12 },
      current,
      returns: [current],
      periods: [{ year: 2025, month: 12 }],
      frequency: { year: 2025 },
      dauerfrist: { year: 2025 },
      mode: "eric",
      herstellerIdConfigured: true,
      companyIssues: [],
      preflight: [],
      periodProblem: null,
      kleinunternehmer: false,
      kz39: 0,
      figures: { ...zero, revenue: [], inputTax: [], reverseCharge: [], igErwerb: [] },
      filings: [],
      submissions: [],
      recent: [],
      posten: [],
      dueDate: "2026-01-12",
      today: "2026-02-10",
    };
    vi.spyOn(Route, "useLoaderData").mockImplementation(() => data as unknown as ReturnType<typeof Route.useLoaderData>);
    const Page = Route.options.component as ComponentType;
    expect(renderToStaticMarkup(createElement(Page))).not.toContain('role="alert"');
    data.figures = { ...data.figures, ...computeUstva({ kz81: 70_000, kz86: 0, kz66: 0 }) };
    const html = renderToStaticMarkup(createElement(Page));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Seit der Übermittlung haben sich die Buchungen dieses Monats geändert");
    expect(html).toContain("Kz 81 700,00");
    expect(html).toContain("lege bei Bedarf eine berichtigte Anmeldung an");
    expect(html).toContain("Berichtigte Anmeldung anlegen");
    expect(html).toMatch(/<output id="kz-81"[^>]*>0,00/);
    vi.restoreAllMocks();
  });
});
