import { formatEuro } from "@haben/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Der Vermerk-Stand braucht weder Router noch Serverfunktion; beides kommt nur im Formular vor
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate: async () => {} }) }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => async () => ({ ok: true }) }));
vi.mock("../../server/functions/annual.ts", () => ({ fileAnnualElsewhere: () => {} }));

import { AbgabeVermerken, type JahresvermerkStand } from "./AbgabeVermerken.tsx";

const VERMERKT: JahresvermerkStand = {
  id: "vermerk-1",
  filedOn: "2026-09-29",
  transferTicket: "ELSTER-2026-0004711",
  note: "Die Umsatzsteuererklärung 2025 haben wir im ELSTER-Portal abgegeben, weil der Belegabruf dort schneller war.",
  amount: 123456,
  hasPdf: true,
};

const render = (vermerkt: JahresvermerkStand) =>
  renderToStaticMarkup(createElement(AbgabeVermerken, { art: "ust", year: 2025, today: "2026-11-13", berechnet: 123456, vermerkt }));

/** Der kompakte Kopf: alles vor dem aufklappbaren Teil */
const kopf = (html: string) => html.slice(0, html.indexOf("<details"));

/** Der aufklappbare Teil samt Inhalt */
const aufgeklappt = (html: string) => html.slice(html.indexOf("<details"));

describe("Vermerk-Karte: kompakter Kopf, Details zugeklappt (#871)", () => {
  it("nennt im Kopf den Tag der Abgabe, den Betrag und das Transferticket", () => {
    const kopfHtml = kopf(render(VERMERKT));
    expect(kopfHtml).toContain("Abgegeben am 29.09.2026");
    expect(kopfHtml).toContain(formatEuro(123456));
    expect(kopfHtml).toContain("ELSTER-2026-0004711");
  });

  it("zeigt den Stand als Status im Kopf", () => {
    const kopfHtml = kopf(render(VERMERKT));
    expect(kopfHtml).toContain('class="status status-ok status-inline"');
    expect(kopfHtml).toContain("Abgegeben");
  });

  it("lässt die Begründung nicht mehr im Kopf stehen, sondern zugeklappt darunter", () => {
    const html = render(VERMERKT);
    expect(kopf(html)).not.toContain("ELSTER-Portal");
    expect(aufgeklappt(html)).toContain("ELSTER-Portal");
  });

  it("klappt den Rest über ein details mit Beschriftung auf, nicht von selbst offen", () => {
    const html = render(VERMERKT);
    expect(html).toContain("<details");
    expect(/<details[^>]*\sopen(=|\s|>)/.test(html)).toBe(false);
    expect(/<summary[^>]*>(?:(?!<\/summary>).)*Begründung/s.test(html)).toBe(true);
  });

  it("legt das Übermittlungsprotokoll mit in den aufklappbaren Teil", () => {
    const html = render(VERMERKT);
    expect(kopf(html)).not.toContain("Übermittlungsprotokoll");
    expect(aufgeklappt(html)).toContain("Übermittlungsprotokoll");
    expect(aufgeklappt(html)).toContain('href="/api/protokoll/vermerk-1"');
  });

  it("lässt den Protokollverweis weg, wenn kein PDF vorliegt", () => {
    const html = render({ ...VERMERKT, hasPdf: false });
    expect(html).not.toContain("Übermittlungsprotokoll");
  });
});
