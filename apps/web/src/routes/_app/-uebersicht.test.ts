import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("../../server/functions/backup.ts", () => ({}));
vi.mock("../../server/functions/invoices.ts", () => ({}));
vi.mock("../../server/functions/vat.ts", () => ({}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useLoaderData: () => state.data }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => createElement("a", { href: to }, children),
}));
import { Route } from "./index.tsx";

function fixture() {
  return {
    period: { year: 2026, month: 10 },
    previousMonth: { year: 2026, month: 10 },
    computedKz83: 0,
    transit: 0,
    vatPaid: 0,
    vatOpen: [],
    dueDate: "2026-11-10",
    exempt: false,
    kleinunternehmer: true,
    afaPending: [],
    appeals: [],
    current: null,
    recent: [],
    certificate: null,
    companyIssues: [],
    companyName: "Musterfirma",
    mode: "simuliert",
    invoices: {
      openTotal: 0,
      openCount: 0,
      overdueCount: 0,
      drafts: 0,
      recent: [],
      bank: [],
      payables: { total: 0, count: 0, overdueCount: 0, nextDue: null },
      revenuePreviousMonth: { net: 0 },
    },
    backup: { failed: [], overdue: false, state: "ok" },
  };
}

const render = () => renderToStaticMarkup(createElement(Route.options.component as ComponentType));

describe("Übersicht: relevante Voranmeldungshinweise (#691)", () => {
  beforeEach(() => {
    state.data = fixture();
  });

  it("Kleinunternehmer ohne Anmeldungen sehen keine regulären UStVA- oder ERiC-Aufforderungen", () => {
    const html = render();
    expect(html).not.toContain("Voranmeldung Oktober 2026");
    expect(html).not.toContain("USt-Zahllast");
    expect(html).not.toContain("ERiC ist nicht eingerichtet");
    expect(html).not.toContain("Letzte Voranmeldungen");
    expect(html).not.toContain("ELSTER-Zertifikat");
    expect(html).toContain("Offene Forderungen");
    expect(html).toContain("Neue Rechnung");
    expect(html).toContain("Umsatz Oktober (netto)");
  });

  it("bei Regelbesteuerung bleiben Voranmeldung, Fälligkeit, Aufgabe und ERiC-Hinweis sichtbar", () => {
    state.data.kleinunternehmer = false;
    const html = render();
    expect(html).toContain("Voranmeldung Oktober 2026 senden");
    expect(html).toContain("Voranmeldung fällig 10.11.2026");
    expect(html).toContain("USt-Zahllast Oktober 2026");
    expect(html).toContain("ERiC ist nicht eingerichtet");
  });

  it("bei Befreiung ohne vorhandene Anmeldung entsteht keine Voranmeldungsaufforderung", () => {
    state.data.kleinunternehmer = false;
    state.data.exempt = true;
    const html = render();
    expect(html).not.toContain("Voranmeldung Oktober 2026");
    expect(html).not.toContain("USt-Zahllast");
    expect(html).not.toContain("ERiC ist nicht eingerichtet");
  });

  it("vorhandene übermittelte Anmeldung bleibt auch für einen Kleinunternehmer erreichbar", () => {
    state.data.current = { status: "sent", kz83: 1900, sentAt: "2026-11-09T12:00:00Z" };
    state.data.recent = [{ id: "test-vat", year: 2026, month: 10, kz83: 1900, sentAt: "2026-11-09T12:00:00Z", berichtigt: false }];
    const html = render();
    expect(html).toContain("USt-Zahllast Oktober 2026");
    expect(html).toContain("Letzte Voranmeldungen");
    expect(html).toContain("19,00");
    expect(html).not.toContain("Voranmeldung Oktober 2026 senden");
    expect(html).not.toContain("Voranmeldung fällig");
  });

  it("offene Zahllast einer älteren Anmeldung bleibt sichtbar, ohne eine neue Aufgabe zu erfinden", () => {
    state.data.vatOpen = [{ vatReturnId: "test-vat", year: 2026, month: 9, offen: 1900, faellig: "2026-10-12", berichtigt: false }];
    const html = render();
    expect(html).toContain("Umsatzsteuer September 2026 nicht bezahlt");
    expect(html).not.toContain("Voranmeldung Oktober 2026 senden");
    expect(html).not.toContain("Voranmeldung fällig");
  });

  it.each([1900, -1900])("berechnete Steuerbeträge bleiben auch ohne reguläre Abgabepflicht sichtbar (%i Cent)", (amount) => {
    state.data.computedKz83 = amount;
    const html = render();
    expect(html).toContain("USt-Zahllast Oktober 2026");
    expect(html).toContain("19,00");
    expect(html).toContain("/umsatzsteuer/$zeitraum");
    expect(html).not.toContain("Voranmeldung Oktober 2026 senden");
    expect(html).not.toContain("Voranmeldung fällig");
  });
});
