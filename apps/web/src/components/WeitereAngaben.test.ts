import { ustIdAufbauProblem, ustIdProblem } from "@haben/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type WeitereAngabenWerte, WeitereAngaben, inWeitereAngaben, isEuVatId, leistungsendeFehler, weitereAngabenKurz } from "./WeitereAngaben.tsx";

const leer: WeitereAngabenWerte = { currency: "EUR", ustId: "", dueDate: "", serviceFrom: "", serviceTo: "", note: "" };

function render(offen: boolean, kurz: string) {
  return renderToStaticMarkup(createElement(WeitereAngaben, { kurz, offen, onOffen: () => {} }, createElement("input", { "aria-label": "Fällig am" })));
}

describe("Weitere Angaben am Beleg", () => {
  it("nennt in der Überschrift die Währung und was sonst gesetzt ist", () => {
    expect(weitereAngabenKurz(leer)).toBe("EUR");
    expect(weitereAngabenKurz({ ...leer, dueDate: "2026-11-30" })).toBe("EUR · fällig 30.11.2026");
    expect(weitereAngabenKurz({ ...leer, currency: "usd", ustId: " IE6388047V ", note: "Jahresabo" })).toBe("USD · USt-IdNr. IE6388047V · Notiz");
  });

  it("zeigt den Leistungszeitraum vollständig oder einseitig", () => {
    expect(weitereAngabenKurz({ ...leer, serviceFrom: "2026-10-01", serviceTo: "2026-10-31" })).toContain("Leistung 01.10.2026 bis 31.10.2026");
    expect(weitereAngabenKurz({ ...leer, serviceFrom: "2026-10-01" })).toContain("Leistung ab 01.10.2026");
    expect(weitereAngabenKurz({ ...leer, serviceTo: "2026-10-31" })).toContain("Leistung bis 31.10.2026");
  });

  it("lässt eine leere Notiz und eine Notiz aus Leerzeichen aus", () => {
    expect(weitereAngabenKurz({ ...leer, note: "   " })).toBe("EUR");
  });

  it("ist zu, bis die Seite ihn aufklappt, und behält die Felder im Bereich", () => {
    const zu = render(false, "EUR");
    expect(zu).toContain("<details");
    expect(zu).not.toMatch(/<details[^>]* open/);
    expect(zu).toContain("<strong>Weitere Angaben</strong>");
    expect(zu).toContain("EUR");
    expect(zu).toContain('aria-label="Fällig am"');
    expect(render(true, "EUR")).toMatch(/<details[^>]* open/);
  });

  it("kennt die Felder im Bereich unter ihrem Namen am Beleg, für Fehler aus Browser und Server", () => {
    for (const feld of ["supplierUstId", "dueDate", "serviceFrom", "serviceTo", "currency", "exchangeRate", "exchangeRateDate", "note"]) {
      expect(inWeitereAngaben(feld), feld).toBe(true);
    }
    for (const feld of ["supplierName", "category", "amounts", "", undefined]) expect(inWeitereAngaben(feld), String(feld)).toBe(false);
  });

  it("hält eine USt-IdNr. aus der EU nur für gültig, wenn auch der Server sie beim Erwerb annimmt (Aufbau je Mitgliedstaat, #1413)", () => {
    for (const nummer of ["FR1234", "FR12345", "FR1234567890123", "NL123456789B01", "IE6388047V", "ATU12345678", "ATU1234", "DE812871812"]) {
      expect(isEuVatId(nummer), nummer).toBe((ustIdProblem(nummer, "L") ?? ustIdAufbauProblem(nummer)) === null);
    }
    expect(isEuVatId("ATU1234")).toBe(false);
    expect(isEuVatId(" atu 1234 5678 ")).toBe(true);
    expect(isEuVatId("XI123456789")).toBe(false);
  });

  it("meldet ein Leistungsende vor dem Beginn am Feld, wie der Server es ablehnt", () => {
    expect(leistungsendeFehler("2026-10-31", "2026-10-01")).toMatch(/Ende.*vor dem Beginn/);
    expect(leistungsendeFehler("2026-10-01", "2026-10-31")).toBeNull();
    expect(leistungsendeFehler("2026-10-01", "2026-10-01")).toBeNull();
    expect(leistungsendeFehler("", "2026-10-01")).toBeNull();
    expect(leistungsendeFehler("2026-10-01", "")).toBeNull();
  });
});
