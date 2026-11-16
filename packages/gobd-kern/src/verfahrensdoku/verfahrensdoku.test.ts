import { describe, expect, it } from "vitest";
import {
  ANGABE_NAMEN,
  ANGABEN_FELDER,
  abschnitt,
  alsMarkdown,
  angabenAbsaetze,
  angabenZumBetrieb,
  datenbankRollenText,
  fehlendeAngaben,
  kernAbschnitt,
  KERN_TEXTE,
  LEERE_ANGABEN,
  markdownText,
  PFLICHTANGABEN,
  tagInDeutschland,
  verfahrensdoku,
} from "./index.ts";

const stand = { datum: "2026-11-16", programm: "Programm", version: "1.2.3" };

describe("Datenmodell", () => {
  it("zählt Lücken und ist nur ohne Lücken vollständig", () => {
    const doku = verfahrensdoku({
      titel: "Verfahrensdokumentation",
      stand,
      abschnitte: [
        abschnitt("1. Allgemein", { absaetze: ["Text"], luecken: ["Anschrift", "Name"] }),
        abschnitt("2. System", { absaetze: ["x"], luecken: ["Ort"] }),
      ],
    });
    expect(doku.luecken).toBe(3);
    expect(doku.vollstaendig).toBe(false);
    expect(verfahrensdoku({ titel: "T", stand, abschnitte: [abschnitt("1.", { absaetze: ["a"] })] }).vollstaendig).toBe(true);
  });

  it("lässt leere Absätze, Listeneinträge und Lücken weg", () => {
    expect(abschnitt("A", { absaetze: ["eins", "", "  "], liste: ["", "x"], luecken: [""] })).toEqual({ titel: "A", absaetze: ["eins"], liste: ["x"] });
  });

  it("verlangt den Stand als Kalendertag", () => {
    expect(() => verfahrensdoku({ titel: "T", stand: { ...stand, datum: "16.11.2026" }, abschnitte: [] })).toThrow(/JJJJ-MM-TT/);
  });

  it("nimmt den Tag in Deutschland, nicht in UTC", () => {
    expect(tagInDeutschland(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });

  it("ist reines JSON und übersteht den Weg zur Druckansicht unverändert", () => {
    const doku = verfahrensdoku({ titel: "T", stand, abschnitte: [abschnitt("1.", { absaetze: ["a"], liste: ["b"], luecken: ["c"] })] });
    expect(JSON.parse(JSON.stringify(doku))).toEqual(doku);
  });
});

describe("Angaben zum Betrieb", () => {
  it("hat zu jedem Feld Beschriftung, Hinweis, Quelle und außer den Ergänzungen eine Lücke", () => {
    for (const name of ANGABE_NAMEN) {
      const feld = ANGABEN_FELDER[name];
      expect(feld.label && feld.hinweis && feld.quelle, name).toBeTruthy();
      expect(Boolean(feld.luecke), name).toBe(name !== "ergaenzungen");
    }
    expect(PFLICHTANGABEN).not.toContain("ergaenzungen");
  });

  it("meldet leere und nur aus Leerzeichen bestehende Angaben als Lücke, in der Reihenfolge der Felder", () => {
    const luecken = fehlendeAngaben({ ...LEERE_ANGABEN, firma: "Muster GmbH", datensicherung: "   " }, [
      "firma",
      "datensicherung",
      "schluesselablage",
      "ergaenzungen",
    ]);
    expect(luecken).toEqual([ANGABEN_FELDER.datensicherung.luecke, ANGABEN_FELDER.schluesselablage.luecke]);
    expect(fehlendeAngaben(LEERE_ANGABEN)).toHaveLength(PFLICHTANGABEN.length);
  });

  it("prüft Länge und kürzt Leerzeichen; eine App nimmt mit pick nur ihre Felder", () => {
    expect(angabenZumBetrieb.parse({ ...LEERE_ANGABEN, firma: "  Muster  " }).firma).toBe("Muster");
    expect(angabenZumBetrieb.safeParse({ ...LEERE_ANGABEN, firma: "x".repeat(301) }).success).toBe(false);
    const teil = angabenZumBetrieb.pick({ datensicherung: true });
    expect(teil.parse({ datensicherung: "täglich", fremd: "weg" })).toEqual({ datensicherung: "täglich" });
  });

  it("macht aus Angaben Absätze mit Beschriftung, Ergänzungen an Leerzeilen geteilt", () => {
    const { absaetze, luecken } = angabenAbsaetze({ datensicherung: "Täglich auf NAS", ergaenzungen: "Erster.\n\nZweiter." }, [
      "datensicherung",
      "serverbetrieb",
      "ergaenzungen",
    ]);
    expect(absaetze).toEqual(["Datensicherung: Täglich auf NAS", "Erster.", "Zweiter."]);
    expect(luecken).toEqual([ANGABEN_FELDER.serverbetrieb.luecke]);
  });
});

describe("Textbausteine zum Kern", () => {
  it("nennt die Randziffern der GoBD, auf die sich die Zusagen stützen", () => {
    expect(KERN_TEXTE.unveraenderbarkeit).toMatch(/Rz\. 108 und 110/);
    expect(KERN_TEXTE.auditLog).toMatch(/Rz\. 59 und 111/);
    expect(KERN_TEXTE.siegel).toMatch(/Rz\. 58 und 107 bis 110/);
    expect(KERN_TEXTE.dateien).toMatch(/Rz\. 110/);
  });

  it("sagt ehrlich, dass die Kette Änderungen sichtbar macht, nicht verhindert", () => {
    expect(KERN_TEXTE.pruefung).toMatch(/verhindert keine Änderung/);
  });

  it("baut den Abschnitt mit Prüfwert, Befunden, Rollen und dem, was die App versiegelt", () => {
    const a = kernAbschnitt("Unveränderbarkeit", {
      versiegelt: ["festgeschriebene Rechnungen"],
      pruefwert: { seq: 42, hash: "a".repeat(64) },
      befunde: 0,
      dateien: true,
      zugriff: { anmeldung: "app", eingeschraenkt: true, probleme: [] },
    });
    expect(a.absaetze.join("\n")).toContain(`Nr. 42 · ${"a".repeat(64)}`);
    expect(a.absaetze).toContain("Die letzte Prüfung von Kette, Kopf und Siegeln fand keine Befunde.");
    expect(a.absaetze).toContain(KERN_TEXTE.dateien);
    expect(a.absaetze.join("\n")).toContain("„app“");
    expect(a.liste).toEqual(["Versiegelt: festgeschriebene Rechnungen"]);
    expect(a.luecken).toBeUndefined();
  });

  it("lässt Dateien, Rollen und Befunde weg, wenn die App sie nicht kennt", () => {
    const a = kernAbschnitt("U", { versiegelt: [] });
    expect(a.absaetze).not.toContain(KERN_TEXTE.dateien);
    expect(a.absaetze.join("\n")).not.toMatch(/Befund|meldet sich/);
    expect(a.liste).toBeUndefined();
  });

  it("nennt bei zu vielen Rechten die gefundenen Probleme und dass Rollen noch fehlen", () => {
    const text = datenbankRollenText({ anmeldung: "postgres", eingeschraenkt: false, probleme: ["Die Anmeldung kann Trigger anlegen."] });
    expect(text).toContain("mit mehr Rechten als nötig: Die Anmeldung kann Trigger anlegen.");
    expect(text).toContain("noch einzurichten");
  });
});

describe("Markdown", () => {
  it("gibt Titel, Stand, Abschnitte, Listen und Lücken aus", () => {
    const doku = verfahrensdoku({
      titel: "Verfahrensdokumentation",
      stand,
      abschnitte: [abschnitt("1. Allgemeine Beschreibung", { absaetze: ["Absatz eins.", "Absatz zwei."], liste: ["Punkt"], luecken: ["Anschrift"] })],
    });
    expect(alsMarkdown(doku)).toBe(
      [
        "# Verfahrensdokumentation",
        "",
        "Stand: 2026-11-16 · Programm 1.2.3 · unvollständig, 1 Angabe fehlt",
        "",
        "## 1\\. Allgemeine Beschreibung",
        "",
        "Absatz eins.",
        "",
        "Absatz zwei.",
        "",
        "- Punkt",
        "",
        "> **Fehlt:** Anschrift",
        "",
      ].join("\n"),
    );
  });

  it("nennt ein vollständiges Dokument vollständig", () => {
    expect(alsMarkdown(verfahrensdoku({ titel: "T", stand, abschnitte: [] }))).toContain("Programm 1.2.3 · vollständig");
  });

  it("maskiert Formatierung und HTML aus Angaben", () => {
    expect(markdownText("*fett* <script> # x")).toBe("\\*fett\\* \\<script\\> \\# x");
    expect(markdownText("- keine Liste\n1. keine Nummer\n---")).toBe("\\- keine Liste  \n1\\. keine Nummer  \n\\---");
  });

  it("macht aus Leerzeilen Absätze und aus Zeilenumbrüchen harte Umbrüche", () => {
    expect(markdownText("Musterstraße 1\n93047 Regensburg\n\n\nZweiter Absatz\n")).toBe("Musterstraße 1  \n93047 Regensburg\n\nZweiter Absatz");
  });
});
