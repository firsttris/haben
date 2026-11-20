import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EuerTabelle } from "./EuerTabelle.tsx";
import type { Data } from "./typen.ts";
import { UstTabelle } from "./UstTabelle.tsx";

const ust = {
  steuer: 97280,
  figures: { base19: 512000, tax19: 97280, base7: 0, tax7: 0, vorsteuer: 0 },
  kz48Gesperrt: [],
  erklaert: {},
  anzeige: { vorauszahlungen: 20000, abschluss: 77280, ausVermerk: { vorauszahlungen: false, abschluss: false } },
};
const euer = { einnahmen: 609280, ausgaben: 100000, gewinn: 509280, erklaert: {} };
const euerRows = {
  einnahmen: [{ key: "steuerpflichtig", label: "Umsatzsteuerpflichtige Betriebseinnahmen", kz: "E6000401", amount: 512000 }],
  ausgaben: [],
  privat: [{ key: "entnahmen", label: "Entnahmen", kz: "E6006601", amount: 0 }],
};
const data = { ust, euer, euerRows, versteuerung: "soll", rechtsform: "einzelunternehmen" } as unknown as Data;

const html = (komponente: typeof UstTabelle) => renderToStaticMarkup(createElement(komponente, { data }));
/** Die Tabellenzeile, deren Beschriftung mit `label` beginnt */
const zeile = (markup: string, label: string) => {
  const treffer = markup.match(new RegExp(`<tr[^>]*><th[^>]*>${label}.*?</tr>`));
  expect(treffer, `keine Zeile „${label}“`).not.toBeNull();
  return treffer![0];
};

/** Alles vor und alles in der eingeklappten Gruppe „Zeilen anzeigen“ */
const teile = (markup: string) => {
  const index = markup.indexOf("<details");
  expect(index, "keine Gruppe „Zeilen anzeigen“").toBeGreaterThan(-1);
  return { davor: markup.slice(0, index), gruppe: markup.slice(index) };
};

describe("UstTabelle", () => {
  it("zeigt die Summen offen und die Einzelzeilen in der Gruppe", () => {
    const { davor, gruppe } = teile(html(UstTabelle));
    expect(zeile(davor, "Umsatzsteuer")).toContain("972,80");
    expect(zeile(davor, "Vorauszahlungssoll")).toContain("200,00");
    expect(zeile(davor, "Abschlusszahlung")).toContain("772,80");
    expect(davor).not.toContain("Umsätze zu 19 %");
    expect(gruppe).toContain("Umsätze zu 19 %");
    expect(gruppe).toContain("Abziehbare Vorsteuer aus Rechnungen");
  });

  it("klappt die Gruppe zu", () => {
    expect(teile(html(UstTabelle)).gruppe).toMatch(/^<details class="est-block">/);
    expect(teile(html(UstTabelle)).gruppe).toContain("Zeilen anzeigen");
  });

  it("nennt eine Erstattung Erstattung", () => {
    const erstattung = { ...data.ust, steuer: -5000, anzeige: { ...data.ust.anzeige, abschluss: -5000 } };
    const markup = renderToStaticMarkup(createElement(UstTabelle, { data: { ...data, ust: erstattung } as Data }));
    expect(teile(markup).davor).toContain("Erstattung");
    expect(teile(markup).davor).toContain("Überschuss");
  });

  it("zeigt Überschuss und Erstattung ohne Minus, die Beschriftung nennt die Richtung (#1412)", () => {
    const erstattung = { ...data.ust, steuer: -11638, anzeige: { ...data.ust.anzeige, vorauszahlungen: 0, abschluss: -11638 } };
    const { davor } = teile(renderToStaticMarkup(createElement(UstTabelle, { data: { ...data, ust: erstattung } as Data })));
    for (const label of ["Überschuss", "Erstattung"]) {
      expect(zeile(davor, label)).toContain("116,38");
      expect(zeile(davor, label), `${label} mit Vorzeichen`).not.toMatch(/[-−]\s*116,38/);
    }
  });

  it("auch mit Vermerk steht die Erstattung ohne Minus; Zahllast und Abschlusszahlung bleiben positiv", () => {
    const vermerk = { ...data.ust, anzeige: { vorauszahlungen: 0, abschluss: -2500, ausVermerk: { vorauszahlungen: true, abschluss: true } } };
    const mitVermerk = teile(renderToStaticMarkup(createElement(UstTabelle, { data: { ...data, ust: vermerk } as Data }))).davor;
    expect(zeile(mitVermerk, "Erstattung laut Vermerk")).toContain("25,00");
    expect(zeile(mitVermerk, "Erstattung laut Vermerk")).not.toMatch(/[-−]\s*25,00/);
    const { davor } = teile(html(UstTabelle));
    expect(zeile(davor, "Umsatzsteuer")).toContain("972,80");
    expect(zeile(davor, "Abschlusszahlung")).toContain("772,80");
  });
});

describe("EuerTabelle", () => {
  it("zeigt Summen und Gewinn offen, Zeilen mit Feldkennung in der Gruppe", () => {
    const { davor, gruppe } = teile(html(EuerTabelle));
    expect(zeile(davor, "Summe Betriebseinnahmen")).toContain("6.092,80");
    expect(zeile(davor, "Summe Betriebsausgaben")).toContain("1.000,00");
    expect(zeile(davor, "Gewinn")).toContain("5.092,80");
    expect(davor).not.toContain("E6000401");
    expect(gruppe).toMatch(/^<details class="est-block">/);
    expect(gruppe).toContain("E6000401");
    expect(gruppe).toContain("E6006601");
  });

  it("nennt einen negativen Gewinn Verlust", () => {
    const verlust = { ...data.euer, gewinn: -100 };
    const markup = renderToStaticMarkup(createElement(EuerTabelle, { data: { ...data, euer: verlust } as Data }));
    expect(teile(markup).davor).toContain("Verlust");
  });
});
