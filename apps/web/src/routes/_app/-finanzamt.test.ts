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
// Die Seite öffnet mit dem ersten Reiter; ohne Klick im statischen Rendern gleich „Bankverbindung ändern“
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  const useState = ((initial: unknown) =>
    original.useState(initial === "vorauszahlung" || initial === "nachricht" ? "bankverbindung" : initial)) as typeof original.useState;
  return { ...original, useState };
});
import { Route } from "./finanzamt.tsx";

type Konto = { id: string; name: string; iban: string; zweck: string };

function fixture(konten: Konto[], taxAccount: { name: string; iban: string } | null = null) {
  return {
    company: { name: "Mustermann IT", finanzamt: "Finanzamt Regensburg", steuernummer: "198/113/10010", iban: "DE89370400440532013000" },
    taxAccount,
    konten,
    person: { vorname: "Max", name: "Mustermann" },
    issues: [],
    bankIssues: [],
    documents: [],
    lastFetch: null,
    pendingConfirmations: { test: 0, live: 0 },
    autoFetch: { enabled: false, lastRun: null, lastError: null },
    basis: null,
    messages: [],
    certificate: null,
    mode: "simuliert",
    herstellerIdConfigured: false,
    today: "2026-11-14",
  };
}

const render = () => renderToStaticMarkup(createElement(Route.options.component as ComponentType));

describe("Finanzamt: Bankverbindung aus den gepflegten Konten (#969)", () => {
  beforeEach(() => {
    state.data = fixture([]);
  });

  it("nennt jeden Zweck eines Kontos mit seinem Namen aus Bank, auch Rücklagen", () => {
    state.data = fixture([{ id: "k1", name: "Tagesgeld", iban: "DE45120300001234567890", zweck: "ruecklage" }]);
    const html = render();
    expect(html).toContain("Tagesgeld · Rücklagen · DE45 1203 0000 1234 5678 90");
    expect(html).not.toContain("ruecklage");
  });

  it("ein Konto mit dem Zweck Steuerkonto ist gewählt, ein freies IBAN-Feld gibt es dann nicht", () => {
    state.data = fixture(
      [
        { id: "k1", name: "Girokonto", iban: "DE89370400440532013000", zweck: "geschaeft" },
        { id: "k2", name: "Steuer", iban: "DE45120300001234567890", zweck: "steuer" },
      ],
      { name: "Steuer", iban: "DE45 1203 0000 1234 5678 90" },
    );
    const html = render();
    expect(html).toMatch(/<option value="k2" selected[^>]*>Steuer · Steuerkonto · DE45 1203 0000 1234 5678 90<\/option>/);
    expect(html).not.toContain('placeholder="DE.."');
  });

  it("ohne gepflegte Konten keine Auswahl, das freie Feld trägt die IBAN der Firmendaten", () => {
    const html = render();
    expect(html).not.toContain("Anderes Konto (IBAN eintippen)");
    expect(html).toMatch(/<input[^>]*value="DE89370400440532013000"[^>]*placeholder="DE.."/);
  });
});
