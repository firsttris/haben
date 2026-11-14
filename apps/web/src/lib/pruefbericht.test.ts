import { describe, expect, it } from "vitest";
import type { IntegrityReport } from "../server/modules/auswertungen/index.ts";
import { dateiBefund, dateienText, integrityNotice } from "./pruefbericht.ts";

const fehlt = { tabelle: "documents", art: "Beleg", zeile: "1", datei: "hosting.pdf", sha256: "ab".repeat(32), befund: "fehlt" as const, weitere: 0 };

const bericht = (aenderung: Partial<IntegrityReport> = {}): IntegrityReport => ({
  head: null,
  entries: 7,
  seals: 2,
  problems: [],
  truncated: false,
  abgleich: { abweichungen: [], hinweise: [] },
  accountCollisions: [],
  files: null,
  ...aenderung,
});

const abweichung = {
  bereich: "euer",
  zeitraum: "2026",
  posten: "Betriebsausgaben",
  journal: 100,
  quelle: 200,
} as IntegrityReport["abgleich"]["abweichungen"][number];

describe("Prüfbericht", () => {
  it("nennt fehlende Dateien in Einzahl und Mehrzahl", () => {
    expect(dateienText(1)).toBe("1 Datei fehlt oder ist verändert");
    expect(dateienText(3)).toBe("3 Dateien fehlen oder sind verändert");
  });

  it("beschreibt einen Befund mit Art, Dateiname und weiteren Datensätzen", () => {
    expect(dateiBefund(fehlt)).toBe("Beleg hosting.pdf: fehlt");
    expect(dateiBefund({ ...fehlt, weitere: 1 })).toBe("Beleg hosting.pdf: fehlt (und 1 weiterer Datensatz)");
    expect(dateiBefund({ ...fehlt, weitere: 36 })).toBe("Beleg hosting.pdf: fehlt (und 36 weitere Datensätze)");
  });

  it("meldet fehlende Dateien rot und verschweigt daneben keine Abweichung", () => {
    const files = { at: new Date(), files: 4, problemCount: 2, problems: [fehlt] };
    expect(integrityNotice(bericht({ files }))).toEqual({
      tone: "danger",
      text: "Kette und Siegel sind unverändert, aber 2 Dateien fehlen oder sind verändert.",
    });
    const beides = integrityNotice(bericht({ files, abgleich: { abweichungen: [abweichung], hinweise: [] } }));
    expect(beides.tone).toBe("danger");
    expect(beides.text).toContain("2 Dateien fehlen oder sind verändert");
    expect(beides.text).toContain("an einer Stelle voneinander ab");
  });

  it("bleibt grün ohne Befund, auch wenn die Dateien noch nie geprüft wurden", () => {
    expect(integrityNotice(bericht()).tone).toBe("ok");
    expect(integrityNotice(bericht({ files: { at: new Date(), files: 4, problemCount: 0, problems: [] } })).tone).toBe("ok");
  });
});
