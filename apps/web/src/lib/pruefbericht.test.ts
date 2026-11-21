import { describe, expect, it } from "vitest";
import type { IntegrityReport } from "../server/modules/auswertungen/index.ts";
import { dateiBefund, dateienText, integrityNotice, pruefwertNotice } from "./pruefbericht.ts";

const fehlt = { tabelle: "documents", art: "Beleg", zeile: "1", datei: "hosting.pdf", sha256: "ab".repeat(32), befund: "fehlt" as const, weitere: 0 };

const bericht = (aenderung: Partial<IntegrityReport> = {}): IntegrityReport => ({
  head: null,
  entries: 7,
  seals: 2,
  problems: [],
  truncated: false,
  abgleich: { abweichungen: [], hinweise: [] },
  accountCollisions: [],
  triggerHints: [],
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
      text: "Kette, Siegel und Sperren sind unverändert, aber 2 Dateien fehlen oder sind verändert.",
    });
    const beides = integrityNotice(bericht({ files, abgleich: { abweichungen: [abweichung], hinweise: [] } }));
    expect(beides.tone).toBe("danger");
    expect(beides.text).toContain("2 Dateien fehlen oder sind verändert");
    expect(beides.text).toContain("Der Abgleich im Journal zeigt eine Abweichung.");
  });

  it("bleibt grün ohne Befund, auch wenn die Dateien noch nie geprüft wurden", () => {
    expect(integrityNotice(bericht()).tone).toBe("ok");
    expect(integrityNotice(bericht({ files: { at: new Date(), files: 4, problemCount: 0, problems: [] } })).tone).toBe("ok");
  });

  // Abweichender Sollbestand: Der Prüfwert stimmt, das Nachrechnen der Kette ist aber nicht verlässlich
  it("bestätigt einen Prüfwert bei abweichendem Sollbestand nicht und nennt Zahl und ersten Befund", () => {
    const befund = "Funktionen: Funktion public.haben_audit_hash(prev bytea, r public.audit_log) wurde verändert";
    expect(pruefwertNotice({ status: "unbestaetigt", seq: 46, befunde: [befund] })).toEqual({
      tone: "danger",
      text: `Prüfwert Nr. 46 stimmt, die Kette lässt sich aber nicht bestätigen: Die Datenbank weicht vom Sollbestand ab (ein Befund, etwa „${befund}“). Wer Trigger oder Funktionen ändern kann, kann auch das Nachrechnen fälschen. „Kette prüfen“ nennt alle Befunde.`,
    });
    expect(
      pruefwertNotice({ status: "unbestaetigt", seq: 46, befunde: [befund, "vat_returns: Zeilensicherheit auf vat_returns eingeschaltet"] }).text,
    ).toContain("(2 Befunde, etwa");
  });

  it("meldet die übrigen Ergebnisse des Prüfwert-Vergleichs wie bisher", () => {
    expect(pruefwertNotice({ status: "ok", seq: 7 }).tone).toBe("ok");
    expect(pruefwertNotice({ status: "beschaedigt", seq: 7, first: 2, befund: "Inhalt passt nicht zum Hash" }).text).toBe(
      "Prüfwert Nr. 7 stimmt, aber Eintrag Nr. 2 davor passt nicht mehr zur Kette (Inhalt passt nicht zum Hash). Er wurde nachträglich verändert.",
    );
    expect(pruefwertNotice({ status: "abweichend", seq: 7, expected: "aa", actual: "bb" }).tone).toBe("danger");
    expect(pruefwertNotice({ status: "fehlt", seq: 9, head: 7 }).text).toContain("Eintrag Nr. 9 fehlt, das Protokoll endet bei Nr. 7.");
  });
});
