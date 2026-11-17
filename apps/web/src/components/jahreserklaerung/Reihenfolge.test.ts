import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { naechsterSchritt, Reihenfolge, SentPill } from "./Reihenfolge.tsx";
import type { Data } from "./typen.ts";

const offen = { sent: null, submitted: null, issues: [] };
const gesendet = { sent: { createdAt: "2026-03-01T10:00:00Z" }, submitted: null, issues: [] };
const vermerkt = (amount: number | null) => ({ sent: null, submitted: { filedOn: "2026-02-10", amount }, issues: [] });
const estUnbekannt = { sent: null, submitted: null, issues: [], verwaltet: false };
// Kleinunternehmer ab 2024: der Fehlerhinweis lässt sich nicht klären, die Erklärung ist nicht geschuldet (§ 18 Abs. 3 UStG)
const ustNichtGeschuldet = {
  sent: null,
  submitted: null,
  issues: [{ tone: "fehler", text: "Als Kleinunternehmer gibst du ab 2024 keine Umsatzsteuererklärung mehr ab" }],
  geschuldet: false,
};
const fehler = { sent: null, submitted: null, issues: [{ tone: "fehler", text: "Steuernummer fehlt" }] };
const stand = (ust: object, euer: object, est: object) => ({ ust, euer, est }) as unknown as Data;

describe("naechsterSchritt", () => {
  it("beginnt bei der Umsatzsteuer", () => {
    expect(naechsterSchritt(stand(offen, offen, offen))).toEqual({ id: "ust", text: "Umsatzsteuer prüfen und übermitteln" });
  });

  it("überspringt übermittelte und vermerkte Erklärungen", () => {
    expect(naechsterSchritt(stand(gesendet, vermerkt(null), offen))?.id).toBe("est");
    expect(naechsterSchritt(stand(gesendet, offen, offen))?.id).toBe("euer");
  });

  it("verlangt bei einem Fehler zuerst, die Hinweise zu klären", () => {
    expect(naechsterSchritt(stand(gesendet, fehler, offen))).toEqual({ id: "euer", text: "Hinweise zur Anlage EÜR klären" });
  });

  it("zählt einen bloßen Hinweis nicht als Fehler", () => {
    const hinweis = { ...offen, issues: [{ tone: "hinweis", text: "Voranmeldung fehlt" }] };
    expect(naechsterSchritt(stand(hinweis, offen, offen))?.text).toBe("Umsatzsteuer prüfen und übermitteln");
  });

  it("nennt die Einkommensteuer nicht, wenn Haben ihren Stand nicht kennt (#869)", () => {
    expect(naechsterSchritt(stand(gesendet, gesendet, estUnbekannt))).toBeNull();
    expect(naechsterSchritt(stand(offen, gesendet, estUnbekannt))?.id).toBe("ust");
  });

  it("überspringt die nicht geschuldete Umsatzsteuererklärung eines Kleinunternehmers, die EÜR wird der nächste Schritt", () => {
    expect(naechsterSchritt(stand(ustNichtGeschuldet, offen, offen))).toEqual({ id: "euer", text: "Anlage EÜR prüfen und übermitteln" });
  });

  it("meldet nichts, wenn alle drei erledigt sind", () => {
    expect(naechsterSchritt(stand(gesendet, gesendet, vermerkt(null)))).toBeNull();
  });
});

describe("Reihenfolge", () => {
  const html = (data: Data) => renderToStaticMarkup(createElement(Reihenfolge, { data }));

  it("nummeriert die Erklärungen in ihrer Reihenfolge und nennt den nächsten Schritt", () => {
    const markup = html(stand(gesendet, offen, offen));
    expect(markup).toMatch(/<ol class="reihenfolge">/);
    const ust = markup.indexOf('href="#ust"');
    const euer = markup.indexOf('href="#euer"');
    const est = markup.indexOf('href="#est"');
    expect(ust).toBeGreaterThan(-1);
    expect(euer).toBeGreaterThan(ust);
    expect(est).toBeGreaterThan(euer);
    expect(markup).toContain('Nächster Schritt:</strong> <a href="#euer">Anlage EÜR prüfen und übermitteln</a>');
  });

  it("zeigt den vermerkten Betrag und, wenn alles erledigt ist, keinen nächsten Schritt", () => {
    const markup = html(stand(vermerkt(123456), gesendet, vermerkt(null)));
    expect(markup).toContain("1.234,56");
    expect(markup).not.toContain("Nächster Schritt");
    expect(markup).toContain("Alle drei Erklärungen sind abgegeben.");
  });

  it("nennt bei nicht geschuldeter Umsatzsteuer die EÜR als nächsten Schritt und sagt, wenn alles Geschuldete abgegeben ist, nicht „drei“", () => {
    expect(html(stand(ustNichtGeschuldet, offen, offen))).toContain('Nächster Schritt:</strong> <a href="#euer">Anlage EÜR prüfen und übermitteln</a>');
    const fertig = html(stand(ustNichtGeschuldet, gesendet, vermerkt(null)));
    expect(fertig).toContain("Alle Erklärungen sind abgegeben.");
    expect(fertig).not.toContain("Nächster Schritt");
  });

  it("sagt ohne Vermerk zur Einkommensteuer weder „nächster Schritt: Einkommensteuer“ noch „alle abgegeben“", () => {
    const markup = html(stand(gesendet, gesendet, estUnbekannt));
    expect(markup).not.toContain('href="#est">Einkommensteuer prüfen');
    expect(markup).not.toContain("Alle drei Erklärungen sind abgegeben.");
    expect(markup).toContain("keiner, den Haben kennt");
  });

  it("sagt bei Umsatzsteuer und EÜR „Noch nicht übermittelt“, nur die Einkommensteuer „Nicht aus Haben übermittelt“ (#869)", () => {
    // Wie die Seite sie lädt: nur die Einkommensteuer trägt `verwaltet: false`
    const markup = html(stand(offen, offen, estUnbekannt));
    expect(markup.match(/Noch nicht übermittelt/g)).toHaveLength(2);
    expect(markup.match(/Nicht aus Haben übermittelt/g)).toHaveLength(1);
  });

  it("sagt bei der nicht geschuldeten Umsatzsteuererklärung „Keine Erklärung nötig“ statt „Noch nicht übermittelt“", () => {
    const markup = html(stand(ustNichtGeschuldet, offen, estUnbekannt));
    expect(markup).toMatch(/<span class="status status-ok status-inline"><span class="status-label">Keine Erklärung nötig<\/span>/);
    expect(markup.match(/Noch nicht übermittelt/g)).toHaveLength(1);
    // Trotzdem übermittelt (etwa auf Aufforderung des Finanzamts): der Stand der Sendung
    expect(html(stand({ ...ustNichtGeschuldet, sent: gesendet.sent }, offen, estUnbekannt))).toContain("Übermittelt am 01.03.2026");
  });

  it("führt zu Belegen von ELSTER und zum Verlauf", () => {
    const markup = html(stand(offen, offen, offen));
    expect(markup).toContain('href="#vast"');
    expect(markup).toContain('href="#verlauf"');
  });
});

// Dieselbe Pille steht neben dem Titel der Umsatzsteuererklärung, auch bei GmbH und UG; sie bekommt den ganzen Teil der Daten
describe("SentPill", () => {
  const html = (teil: object) => renderToStaticMarkup(createElement(SentPill, { teil } as never));

  it("liest Sendung, Vermerk und ob die Erklärung geschuldet ist aus dem Teil der Daten", () => {
    expect(html(ustNichtGeschuldet)).toContain("Keine Erklärung nötig");
    expect(html(offen)).toContain("Noch nicht übermittelt");
    expect(html(estUnbekannt)).toContain("Nicht aus Haben übermittelt");
    expect(html(vermerkt(null))).toContain("Außerhalb abgegeben am 10.02.2026");
  });
});
