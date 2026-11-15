import { describe, expect, it } from "vitest";
import { abrufFaellig, gebuehrenBisAm, laenderHinweis, naechsterAbrufStart } from "./abruf-regeln.ts";

describe("Regeln des Etsy-Abrufs", () => {
  it("bündelt einen Monat erst ab dem 5. des Folgemonats", () => {
    expect(gebuehrenBisAm("2026-11-04")).toBe("2026-09-30");
    expect(gebuehrenBisAm("2026-11-05")).toBe("2026-10-31");
    expect(gebuehrenBisAm("2026-11-30")).toBe("2026-10-31");
    expect(gebuehrenBisAm("2026-03-05")).toBe("2026-02-28");
  });

  it("rechnet über den Jahreswechsel", () => {
    expect(gebuehrenBisAm("2027-01-03")).toBe("2026-11-30");
    expect(gebuehrenBisAm("2027-01-05")).toBe("2026-12-31");
    expect(gebuehrenBisAm("2027-02-01")).toBe("2026-12-31");
  });

  it("holt den laufenden Monat bei jedem Abruf ab seinem 1., weil er noch nicht gebündelt ist", () => {
    // Oktober ist gebündelt (Abruf am 20.11.), die jüngste Zeile vom 19.11.: nicht ab dem 16.11., sonst fehlten am 5.12.
    // die November-Gebühren vom 1. bis 15.
    expect(naechsterAbrufStart(["2026-11-02", "2026-11-19"], "2026-11-01", "2026-10-31")).toBe("2026-11-01");
  });

  it("hält den Abruf am 1. des noch nicht gebündelten Monats fest, damit dessen Gebühren nicht verloren gehen", () => {
    // Am 2.11. ist der Oktober noch offen: Seine Gebühren vom 3.10. müssen beim Abruf am 5.11. noch dabei sein
    expect(naechsterAbrufStart(["2026-10-03", "2026-11-02"], "2026-10-01", "2026-09-30")).toBe("2026-10-01");
    // Am 20.11. ist der Oktober gebündelt, der November offen: ab dem 1.11.
    expect(naechsterAbrufStart(["2026-11-19"], "2026-10-01", "2026-10-31")).toBe("2026-11-01");
  });

  it("geht nie vor den bisherigen Start zurück, auch nicht vor einen frisch gewählten Monat", () => {
    // Am 3.11. „Abruf ab 2026-11“ gewählt: der Oktober ist noch offen, gehört aber nicht dazu
    expect(naechsterAbrufStart(["2026-11-02"], "2026-11-01", "2026-09-30")).toBe("2026-11-01");
  });

  it("lässt den Start ohne neue Zeilen stehen", () => {
    expect(naechsterAbrufStart([], "2026-11-01", "2026-10-31")).toBe("2026-11-01");
  });

  it("darf mit der Überlappung in einen gebündelten Monat reichen; der Import überspringt dessen Gebühren", () => {
    // Abruf am 6.11. bündelt den Oktober, die jüngste Zeile ist vom 2.11.
    expect(naechsterAbrufStart(["2026-11-02"], "2026-10-01", "2026-10-31")).toBe("2026-10-30");
  });

  it("ruft je nach Rhythmus stündlich, täglich oder wöchentlich ab", () => {
    const letzter = (iso: string) => ({ zeit: new Date(iso), tag: iso.slice(0, 10), fehlgeschlagen: false });
    const jetzt = new Date("2026-11-20T12:00:00Z");
    expect(abrufFaellig("stuendlich", letzter("2026-11-20T11:05:00Z"), jetzt, "2026-11-20")).toBe(true);
    expect(abrufFaellig("stuendlich", letzter("2026-11-20T11:30:00Z"), jetzt, "2026-11-20")).toBe(false);
    expect(abrufFaellig("taeglich", letzter("2026-11-19T12:00:00Z"), jetzt, "2026-11-20")).toBe(true);
    expect(abrufFaellig("taeglich", letzter("2026-11-20T06:00:00Z"), jetzt, "2026-11-20")).toBe(false);
    expect(abrufFaellig("woechentlich", letzter("2026-11-13T12:00:00Z"), jetzt, "2026-11-20")).toBe(true);
    expect(abrufFaellig("woechentlich", letzter("2026-11-16T12:00:00Z"), jetzt, "2026-11-20")).toBe(false);
    expect(abrufFaellig("woechentlich", null, jetzt, "2026-11-20")).toBe(true);
  });

  it("ruft monatlich einmal ab dem 5. ab, wenn die Gebühren des Vormonats gebündelt werden können", () => {
    const am = (tag: string) => ({ zeit: new Date(`${tag}T09:00:00Z`), tag, fehlgeschlagen: false });
    expect(abrufFaellig("monatlich", am("2026-10-05"), new Date("2026-11-04T12:00:00Z"), "2026-11-04")).toBe(false);
    expect(abrufFaellig("monatlich", am("2026-10-05"), new Date("2026-11-05T08:00:00Z"), "2026-11-05")).toBe(true);
    expect(abrufFaellig("monatlich", am("2026-11-05"), new Date("2026-11-20T12:00:00Z"), "2026-11-20")).toBe(false);
    // Von Hand am 3. abgerufen: am 5. trotzdem fällig, sonst fehlten die Oktober-Sammelzeilen bis Dezember
    expect(abrufFaellig("monatlich", am("2026-11-03"), new Date("2026-11-05T08:00:00Z"), "2026-11-05")).toBe(true);
  });

  it("versucht es nach einem Fehlschlag spätestens am nächsten Tag erneut, auch monatlich", () => {
    const fehler = { zeit: new Date("2026-11-05T08:00:00Z"), tag: "2026-11-05", fehlgeschlagen: true };
    expect(abrufFaellig("monatlich", fehler, new Date("2026-11-05T20:00:00Z"), "2026-11-05")).toBe(false);
    expect(abrufFaellig("monatlich", fehler, new Date("2026-11-06T08:00:00Z"), "2026-11-06")).toBe(true);
    expect(abrufFaellig("woechentlich", fehler, new Date("2026-11-06T08:00:00Z"), "2026-11-06")).toBe(true);
  });

  it("zählt die Bestellungen nach Land", () => {
    const laender = new Map([
      ["1", "DE"],
      ["2", "US"],
      ["3", "US"],
      ["4", "FR"],
    ]);
    expect(laenderHinweis(["1", "2", "3", "4", "5"], laender)).toBe(
      "Bestellungen nach Land: 1 Deutschland (19 %), 2 USA (nicht steuerbar, Kz 45), 1 anderes Land (Steuer klären, keine Rechnung), 1 ohne Land.",
    );
    expect(laenderHinweis([], laender)).toBeNull();
  });
});
