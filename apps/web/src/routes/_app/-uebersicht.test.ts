import { germanDay } from "@haben/core";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => createElement("a", { href: to, className }, children),
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
    expect(html).toContain("Neue Rechnung");
  });

  it("bei Regelbesteuerung bleiben Voranmeldung, Fälligkeit, Aufgabe und ERiC-Hinweis sichtbar", () => {
    state.data.kleinunternehmer = false;
    (state.data.invoices as { revenuePreviousMonth: number }).revenuePreviousMonth = 100000;
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

// Aufbau (#1253): „Zu erledigen“ zuerst, die drei dringendsten offen, der Rest unter „Weitere“
describe("Übersicht: Aufbau", () => {
  beforeEach(() => {
    state.data = fixture();
    state.einrichtung = null;
  });

  it("zeigt die drei dringendsten Aufgaben, den Rest unter „Weitere (n)“, und das vor den Kennzahlen", () => {
    state.data.kleinunternehmer = false;
    state.data.transit = 50000; // Warnung
    state.data.afaPending = [{ year: 2025, count: 2 }]; // Hinweis
    (state.data.invoices as { drafts: number }).drafts = 1; // Anstehendes
    (state.data.invoices as { openCount: number }).openCount = 1; // Kennzahlen sichtbar
    state.data.backup = { failed: [], overdue: false, state: "keins" }; // Anstehendes
    const html = render();
    // Voranmeldung ist überfällig (Fälligkeit 10.11.): Warnung wie der Geldtransit, dann folgt die AfA
    const zuerst = html.slice(0, html.indexOf("<details"));
    expect(zuerst).toContain("Geldtransit nicht ausgeglichen");
    expect(zuerst).toContain("Voranmeldung Oktober 2026 senden");
    expect(zuerst).toContain("Abschreibung (AfA) 2025 buchen");
    expect(zuerst).not.toContain("Backup einrichten");
    const weitere = html.slice(html.indexOf("<details"), html.indexOf("</details>"));
    expect(weitere).toContain("Weitere (3)");
    expect(weitere).toContain("1 Rechnungsentwurf");
    expect(weitere).toContain("ELSTER-Zertifikat hinterlegen");
    expect(weitere).toContain("Backup einrichten");
    expect(html.indexOf("Zu erledigen")).toBeLessThan(html.indexOf("Offene Forderungen"));
  });

  it("bis zu drei Aufgaben stehen ohne „Weitere“ da", () => {
    state.data.transit = 50000;
    const html = render();
    expect(html).toContain("Geldtransit nicht ausgeglichen");
    expect(html).not.toContain("Weitere (");
  });

  it("die Voranmeldung steht als Aufgabe, nicht mehr zusätzlich als Knopf im Kopf", () => {
    state.data.kleinunternehmer = false;
    expect(render()).not.toContain("btn-ghost");
  });

  it("ist die Voranmeldung gesendet, bleibt der Weg dorthin als stiller Link im Kopf", () => {
    state.data.current = { status: "sent", kz83: 1900, sentAt: "2026-11-09T12:00:00Z" };
    const html = render();
    expect(html).toContain('class="btn btn-ghost"');
    expect(html).toContain("Voranmeldung Oktober 2026</a>");
  });

  it("leere Instanz: Knopf „Erste Rechnung schreiben“, keine Karten mit 0,00 €", () => {
    const html = render();
    expect(html).toContain("Erste Rechnung schreiben");
    expect(html).toContain('href="/rechnungen/neu"');
    expect(html).not.toContain("Offene Forderungen");
    expect(html).not.toContain("0,00");
  });

  it("mit Daten erscheinen die Karten, und der Knopf entfällt", () => {
    const invoices = state.data.invoices as { recent: unknown[]; openCount: number; openTotal: number };
    invoices.recent = [{ id: "r1", number: "2026-001", customer: "Nordwerk", gross: 11900, listStatus: "bezahlt" }];
    invoices.openCount = 1;
    invoices.openTotal = 11900;
    const html = render();
    expect(html).toContain("Offene Forderungen");
    expect(html).toContain("Umsatz Oktober (netto)");
    expect(html).not.toContain("Erste Rechnung schreiben");
  });

  // Jede Zahl allein reicht für die Kennzahlenreihe; sonst verschwänden Karten mit Zahlen (`ohneKennzahlen`)
  const konto = { id: "k1", name: "Girokonto", purpose: "geschaeft", balance: 0, balanceDate: null, openCount: 0, staleOpenCount: 0 };
  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    ["festgeschriebene Rechnung", { recent: [{ id: "r1", number: "2026-001", customer: "Nordwerk", gross: 11900, listStatus: "bezahlt" }] }, {}],
    ["offene Forderung", { openCount: 1 }, {}],
    ["offene Verbindlichkeit", { payables: { total: 0, count: 1, overdueCount: 0, nextDue: null } }, {}],
    ["Umsatz im Vormonat", { revenuePreviousMonth: -5000 }, {}],
    ["Zahllast", {}, { computedKz83: -1900 }],
    ["Voranmeldung des Zeitraums", {}, { current: { status: "draft", kz83: 0, sentAt: null } }],
    ["Kontostand 0,00 €", { bank: [konto] }, {}],
  ])("Kennzahlen erscheinen schon mit %s allein", (_name, rechnungen, uebersicht) => {
    Object.assign(state.data, uebersicht);
    Object.assign(state.data.invoices as object, rechnungen);
    expect(render()).toContain("Umsatz Oktober (netto)");
  });

  // Nahe Fristen (Voranmeldung, Bescheid, Zertifikat; bis 14 Tage) gehen vor, nach Fälligkeit; sonst verschwänden sie hinter drei Warnungen
  // Kalendertage, nicht n * 24 Stunden: Sonst kippt es in den zwei Wochen vor der Zeitumstellung zwischen 23 und 1 Uhr
  const inTagen = (n: number) => {
    const tag = new Date(`${germanDay()}T12:00:00Z`);
    tag.setUTCDate(tag.getUTCDate() + n);
    return tag.toISOString().slice(0, 10);
  };
  const sichtbar = (html: string) => (html.includes("<details") ? html.slice(0, html.indexOf("<details")) : html);

  it("Voranmeldung in 5 Tagen bleibt sichtbar, auch bei drei Warnungen davor (früher: Knopf im Kopf)", () => {
    const d = state.data as ReturnType<typeof fixture> & Record<string, unknown>;
    d.kleinunternehmer = false;
    d.dueDate = inTagen(5);
    d.transit = 50000;
    (d.invoices as { overdueCount: number; openCount: number }).overdueCount = 2;
    (d.invoices as { openCount: number }).openCount = 2;
    d.backup = { failed: [], overdue: true, state: "ok" };
    const html = render();
    expect(sichtbar(html)).toContain("Voranmeldung Oktober 2026 senden");
  });

  it("Einspruchsfrist morgen steht vor „Rechtsform festlegen“ und weiteren Warnungen", () => {
    const d = state.data as Record<string, unknown>;
    state.einrichtung = { fehlt: false, offen: ["rechtsform"] };
    d.transit = 50000;
    (d.invoices as { overdueCount: number; openCount: number }).overdueCount = 2;
    (d.invoices as { openCount: number }).openCount = 2;
    d.appeals = [{ id: "b1", veranlagungszeitraum: 2025, datenart: "ESB", fristende: inTagen(1) }];
    const html = render();
    expect(sichtbar(html)).toContain("Bescheid 2025 prüfen");
  });

  it("Fristen stehen nach Fälligkeit; rutscht die Voranmeldung unter „Weitere“, bleibt der Weg als Knopf im Kopf", () => {
    const d = state.data as Record<string, unknown>;
    d.kleinunternehmer = false;
    d.dueDate = inTagen(5);
    d.appeals = [1, 2, 3].map((n) => ({ id: `b${n}`, veranlagungszeitraum: 2020 + n, datenart: "ESB", fristende: inTagen(n) }));
    const html = render();
    const zuerst = sichtbar(html);
    expect(zuerst.indexOf("Bescheid 2021 prüfen")).toBeLessThan(zuerst.indexOf("Bescheid 2022 prüfen"));
    expect(zuerst).toContain("Bescheid 2023 prüfen");
    expect(zuerst).not.toContain("Voranmeldung Oktober 2026 senden");
    expect(html.slice(html.indexOf("<details"))).toContain("Voranmeldung Oktober 2026 senden");
    expect(zuerst).toContain('class="btn btn-ghost"');
  });

  // Platzt die Lastschrift, gilt die Steuer nicht als am Fälligkeitstag entrichtet (§ 224 Abs. 2 Nr. 3 AO), es drohen Säumniszuschläge (§ 240 AO)
  it("Steuerkonto deckt die Zahllast nicht: die Fälligkeit zählt als Frist und geht der späteren Voranmeldung vor", () => {
    const d = state.data as Record<string, unknown>;
    d.kleinunternehmer = false;
    d.dueDate = inTagen(5);
    d.computedKz83 = 100000;
    (d.invoices as { bank: unknown[] }).bank = [
      { id: "s1", name: "Rücklage", purpose: "steuer", balance: 20000, balanceDate: null, openCount: 0, staleOpenCount: 0 },
    ];
    d.appeals = [1, 2].map((n) => ({ id: `b${n}`, veranlagungszeitraum: 2020 + n, datenart: "ESB", fristende: inTagen(n) }));
    const zuerst = sichtbar(render());
    expect(zuerst).toContain("Steuerkonto Rücklage deckt die Zahllast nicht");
    expect(zuerst).toContain("Es fehlen 800,00");
    expect(zuerst.indexOf("Bescheid 2022 prüfen")).toBeLessThan(zuerst.indexOf("deckt die Zahllast nicht"));
  });

  const dreiWarnungen = () => {
    const d = state.data as ReturnType<typeof fixture> & Record<string, unknown>;
    d.kleinunternehmer = false;
    d.transit = 50000;
    (d.invoices as { overdueCount: number; openCount: number }).overdueCount = 2;
    (d.invoices as { openCount: number }).openCount = 2;
    d.backup = { failed: [], overdue: true, state: "ok" };
    return d;
  };

  it("eine ferne Frist (25 Tage) kommt nach den Warnungen, der Kopfknopf bleibt", () => {
    dreiWarnungen().dueDate = inTagen(25);
    const html = render();
    expect(sichtbar(html)).not.toContain("Voranmeldung Oktober 2026 senden");
    expect(html.slice(html.indexOf("<details"))).toContain("Voranmeldung Oktober 2026 senden");
    expect(sichtbar(html)).toContain('class="btn btn-ghost"');
  });

  it.each([
    [14, true],
    [15, false],
  ])("die Grenze der nahen Frist: in %i Tagen vorn = %s", (tage, vorn) => {
    dreiWarnungen().dueDate = inTagen(tage);
    expect(sichtbar(render()).includes("Voranmeldung Oktober 2026 senden")).toBe(vorn);
  });

  describe("Grenze der nahen Frist rund um die Zeitumstellung", () => {
    afterEach(() => vi.useRealTimers());

    it.each([
      ["Frühjahr, 23:30 MEZ", "2027-03-20T22:30:00Z"],
      ["Herbst, 00:30 MESZ", "2026-10-19T22:30:00Z"],
    ])("%s: 14 Tage vorn, 15 nicht", (_name, jetzt) => {
      vi.setSystemTime(new Date(jetzt));
      dreiWarnungen();
      for (const [tage, vorn] of [
        [14, true],
        [15, false],
      ] as const) {
        (state.data as Record<string, unknown>).dueDate = inTagen(tage);
        expect(sichtbar(render()).includes("Voranmeldung Oktober 2026 senden"), `in ${tage} Tagen`).toBe(vorn);
      }
    });
  });
});
