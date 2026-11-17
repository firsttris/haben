import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  einrichtung: null as { fehlt: boolean; offen: ("rechtsform" | "kleinunternehmer")[] } | null,
}));
vi.mock("../../server/functions/backup.ts", () => ({}));
vi.mock("../../server/functions/invoices.ts", () => ({}));
vi.mock("../../server/functions/vat.ts", () => ({}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useLoaderData: () => state.data,
    useRouteContext: () => ({ einrichtung: state.einrichtung }),
  }),
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
      revenuePreviousMonth: 0,
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

// Fragen zur Einrichtung (#266): Die Übersicht erinnert, solange sie fehlen oder etwas offen ist
describe("Übersicht: Fragen zur Einrichtung", () => {
  beforeEach(() => {
    state.data = fixture();
    state.einrichtung = null;
  });

  it("erinnert eine neue Instanz an die Fragen", () => {
    state.einrichtung = { fehlt: true, offen: [] };
    const html = render();
    expect(html).toContain("Haben einrichten");
    expect(html).toContain('href="/einrichtung"');
  });

  it("erinnert an Rechtsform und Kleinunternehmer, solange sie offen sind", () => {
    state.einrichtung = { fehlt: false, offen: ["rechtsform", "kleinunternehmer"] };
    const html = render();
    expect(html).toContain("Rechtsform festlegen");
    expect(html).toContain("Kleinunternehmer klären");
    expect(html).not.toContain("Haben einrichten");
  });

  it("ohne Fragen und Offenes kein Hinweis", () => {
    state.einrichtung = { fehlt: false, offen: [] };
    const html = render();
    expect(html).not.toContain("Haben einrichten");
    expect(html).not.toContain("Kleinunternehmer klären");
  });
});

// Hinweise in Alltagssprache (#1253): Fachwort bleibt erkennbar, Ziel (Link) bleibt
describe("Übersicht: Hinweise in Klartext", () => {
  beforeEach(() => {
    state.data = fixture();
    state.einrichtung = null;
  });

  it("Geldtransit: sagt, was zwischen den Konten fehlt, in beiden Richtungen", () => {
    state.data.transit = 50000;
    let html = render();
    expect(html).toContain("Geldtransit nicht ausgeglichen");
    expect(html).toContain("500,00");
    expect(html).toContain("abgegangen, aber auf keinem deiner Konten angekommen");
    expect(html).toContain("Beim Geldtransit, dem Geld zwischen deinen eigenen Konten, fehlt die Gegenbuchung");
    expect(html).toContain('href="/bank"');
    state.data.transit = -50000;
    html = render();
    expect(html).toContain("angekommen, ohne dass es woanders abgegangen ist");
  });

  it("AfA: Abschreibung ausgeschrieben, AfA in Klammern, Ziel bleibt das Anlagenverzeichnis", () => {
    state.data.afaPending = [{ year: 2025, count: 2 }];
    const html = render();
    expect(html).toContain("Abschreibung (AfA) 2025 buchen");
    expect(html).toContain("Für 2 Anlagen im Anlagenverzeichnis ist sie noch nicht gebucht");
    expect(html).toContain('href="/anlagen"');
  });
});
