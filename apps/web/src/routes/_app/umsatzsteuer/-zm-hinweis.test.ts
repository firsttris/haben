import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("../../../server/functions/zm.ts", () => ({ getZm: {}, submitZmMeldung: {} }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => async () => ({}) }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useLoaderData: () => state.data }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => createElement("a", { href: to }, children),
  notFound: () => new Error("notFound"),
  useNavigate: () => async () => {},
  useRouter: () => ({ invalidate: async () => {} }),
}));
import { Route } from "./zm.$quartal.tsx";

describe("ZM-Seite: Hinweis bei fehlendem ERiC", () => {
  it("sagt nicht, dass nichts ans Finanzamt geht: die ZM geht an das BZSt", () => {
    state.data = {
      mode: "simuliert",
      period: { year: 2026, month: 41 },
      quartale: [{ year: 2026, month: 41 }],
      issues: [],
      zeilen: [],
      quellen: [],
      kz21: null,
      kz41: null,
      frist: "2026-04-25",
      sent: false,
      submissions: [],
      naechste: { zeilen: [], berichtigt: false },
    };
    const Seite = (Route as unknown as { options: { component: ComponentType } }).options.component;
    const html = renderToStaticMarkup(createElement(Seite));
    const hinweis = /ERiC ist nicht eingerichtet[^<]*/.exec(html)?.[0];
    expect(hinweis).toBeDefined();
    expect(hinweis).not.toMatch(/Finanzamt/);
  });
});
