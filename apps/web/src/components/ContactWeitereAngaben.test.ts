import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ContactInput } from "../server/modules/stammdaten/index.ts";
import { betrifftWeitereAngaben, ContactWeitereAngaben, type KontaktWeitereWerte, kontaktWeitereKurz } from "./ContactWeitereAngaben.tsx";

const leer: KontaktWeitereWerte = { debitorNr: "", kreditorNr: "", hourlyRate: "", leitwegId: "", defaultFormat: "", ownSkonto: false, skonto: [] };
const initial = { leitwegId: "991-01234-44", debitorNr: 10050, hourlyRateCents: 9500, defaultFormat: "xrechnung-cii" } as ContactInput;

function render(offen: boolean) {
  return renderToStaticMarkup(
    createElement(ContactWeitereAngaben, {
      initial,
      ownSkonto: false,
      onOwnSkonto: () => {},
      skontoRows: [],
      onSkontoRows: () => {},
      offen,
      onOffen: () => {},
    }),
  );
}

describe("Weitere Angaben am Kontakt", () => {
  it("nennt in der Überschrift, was gesetzt ist, sonst was im Bereich steht", () => {
    expect(kontaktWeitereKurz(leer)).toBe("optional: DATEV-Konten, Skonto, Stundensatz, Leitweg-ID, Rechnungsformat");
    expect(kontaktWeitereKurz({ ...leer, leitwegId: "991-01234-44", ownSkonto: true, skonto: [{ days: 10, percent: 200 }] })).toBe(
      "Leitweg-ID gesetzt · Skonto 2 % in 10 Tagen",
    );
    expect(kontaktWeitereKurz({ ...leer, debitorNr: " 10050 ", hourlyRate: "95,00", defaultFormat: "zugferd" })).toBe(
      "DATEV-Debitor 10050 · Stundensatz 95,00 € · Format ZUGFeRD",
    );
  });

  it("zeigt eigenes Skonto ohne Stufe als „ohne Skonto“ und krumme Sätze mit Komma", () => {
    expect(kontaktWeitereKurz({ ...leer, ownSkonto: true })).toBe("ohne Skonto");
    expect(
      kontaktWeitereKurz({
        ...leer,
        ownSkonto: true,
        skonto: [
          { days: 7, percent: 250 },
          { days: 30, percent: 100 },
        ],
      }),
    ).toBe("Skonto 2,50 % in 7 Tagen, 1 % in 30 Tagen");
  });

  it("ist zu, bis die Seite ihn aufklappt, und behält alle Felder samt Werten im Bereich", () => {
    const zu = render(false);
    expect(zu).not.toMatch(/<details[^>]* open/);
    expect(zu).toContain("Leitweg-ID gesetzt");
    for (const feld of ["debitorNr", "kreditorNr", "hourlyRateCents", "leitwegId", "defaultFormat"]) expect(zu, feld).toContain(`name="${feld}"`);
    expect(zu).toContain('value="10050"');
    expect(zu).toContain('value="95,00"');
    expect(zu).toContain('value="991-01234-44"');
    expect(render(true)).toMatch(/<details[^>]* open/);
  });

  it("erkennt Meldungen zu Feldern im Bereich, aus Formular und Server", () => {
    for (const meldung of [
      "Debitor: 10000 bis 69999 (fünfstellig, nach DATEV-Kontenrahmen)",
      "Kreditor 70087 hat schon „Muster GmbH“.",
      "Skonto: je Stufe einen Satz (z. B. 2) und eine Frist in Tagen angeben.",
      "Bitte den Stundensatz als Betrag angeben",
    ]) {
      expect(betrifftWeitereAngaben(meldung), meldung).toBe(true);
    }
    for (const meldung of ["Ein Kontakt ist Kunde oder Lieferant oder beides.", "Kontakt nicht gefunden."])
      expect(betrifftWeitereAngaben(meldung), meldung).toBe(false);
  });
});
