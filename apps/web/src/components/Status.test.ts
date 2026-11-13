import { formatEuro } from "@haben/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoiceStatusDetail } from "./InvoiceStatus.tsx";
import { quoteStatusDetail } from "./QuoteStatus.tsx";
import { OutcomeStatus, Status, Tag } from "./Status.tsx";

const html = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(element);
/** Was Screenreader und Kopieren sehen: Text ohne Tags */
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");

describe("Status", () => {
  it("ruhig: Klasse des Tons, ohne Stufe", () => {
    const markup = html(createElement(Status, { tone: "ok" }, "Bezahlt"));
    expect(markup).toBe('<span class="status status-ok"><span class="status-label">Bezahlt</span></span>');
  });

  it("Stufe, Entwurf und Zeile kommen als Klassen dazu", () => {
    const markup = html(createElement(Status, { tone: "warn", emphasis: "urgent", draft: true, inline: true }, "Überfällig"));
    expect(markup).toContain('class="status status-warn status-urgent status-draft status-inline"');
  });

  it("ohne Ton neutral", () => {
    expect(html(createElement(Status, null, "Offen"))).toContain('class="status status-neutral"');
  });

  it("Auskunft mit Leerzeichen zum Wort, sonst läse der Screenreader „Bezahltam 30.10.“", () => {
    const markup = html(createElement(Status, { tone: "ok", detail: "am 30.10." }, "Bezahlt"));
    expect(markup).toContain('<span class="status-detail">am 30.10.</span>');
    expect(text(markup)).toBe("Bezahlt am 30.10.");
  });

  it("leere Auskunft erzeugt keine Zeile", () => {
    expect(html(createElement(Status, { detail: "" }, "Offen"))).not.toContain("status-detail");
    expect(html(createElement(Status, { detail: null }, "Offen"))).not.toContain("status-detail");
  });

  it("Ergebnis im Protokoll: Erfolg ruhig, Fehler dringend", () => {
    expect(html(createElement(OutcomeStatus, { ok: true }, "OK"))).toContain('class="status status-ok status-inline"');
    expect(html(createElement(OutcomeStatus, { ok: false }, "Fehler 610301200"))).toContain('class="status status-danger status-urgent status-inline"');
  });

  it("Merkmal ohne Punkt und Ton", () => {
    expect(html(createElement(Tag, null, "Lieferant"))).toBe('<span class="tag">Lieferant</span>');
  });
});

describe("Auskunft unter dem Status", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const invoice = { dueDate: "2026-11-23", gross: 476_000, paid: 0, open: 476_000 };

  it("Rechnung: Fälligkeit, Zahlstand, Tage überfällig, Zahldatum, Storno", () => {
    expect(invoiceStatusDetail({ ...invoice, listStatus: "entwurf" })).toBe("noch nicht festgeschrieben");
    expect(invoiceStatusDetail({ ...invoice, listStatus: "offen" })).toBe("fällig 23.11.");
    expect(invoiceStatusDetail({ ...invoice, listStatus: "teilbezahlt", paid: 238_000, open: 238_000 })).toBe(`${formatEuro(238_000)} von ${formatEuro(476_000)}`);
    expect(invoiceStatusDetail({ ...invoice, listStatus: "ueberfaellig", dueDate: "2026-10-02" })).toBe("seit 40 Tagen");
    // Teilweise bezahlt und überfällig: der Rest gehört dazu
    expect(invoiceStatusDetail({ ...invoice, listStatus: "ueberfaellig", dueDate: "2026-11-10", paid: 100_000, open: 376_000 })).toBe(`seit 1 Tag, ${formatEuro(376_000)} offen`);
    expect(invoiceStatusDetail({ ...invoice, listStatus: "bezahlt", settledOn: "2026-10-30" })).toBe("am 30.10.");
    expect(invoiceStatusDetail({ ...invoice, listStatus: "bezahlt", settledOn: null })).toBeNull();
    expect(invoiceStatusDetail({ ...invoice, listStatus: "storniert", cancelledBy: "2026-011" })).toBe("durch 2026-011");
    expect(invoiceStatusDetail({ ...invoice, listStatus: "storno", correctsNumber: "2026-010" })).toBe("zu 2026-010");
    expect(invoiceStatusDetail({ ...invoice, listStatus: "korrektur", correctsNumber: null })).toBeNull();
  });

  it("Angebot: Restlaufzeit statt des Datums, das in der Spalte daneben steht", () => {
    expect(quoteStatusDetail({ listStatus: "offen", validUntil: "2026-12-06" })).toBe("gilt noch 25 Tage");
    expect(quoteStatusDetail({ listStatus: "offen", validUntil: "2026-11-12" })).toBe("gilt noch 1 Tag");
    expect(quoteStatusDetail({ listStatus: "offen", validUntil: "2026-11-11" })).toBe("gilt bis heute");
    expect(quoteStatusDetail({ listStatus: "abgelaufen", validUntil: "2026-10-31" })).toBe("seit 11 Tagen");
    expect(quoteStatusDetail({ listStatus: "abgerechnet", validUntil: "2026-10-31", invoiceNumber: "2026-012" })).toBe("mit 2026-012");
    expect(quoteStatusDetail({ listStatus: "abgerechnet", validUntil: "2026-10-31", invoiceNumber: null })).toBeNull();
  });
});
