import { describe, expect, it } from "vitest";
import { aktion, eigenerKommentar, entschaerfen, ergebnisLesen, type Kommentar, kommentarText, MARKER } from "./kommentar.ts";
import type { Report } from "./regel.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const fehler: Report = { level: "error", message: "Titel „x“ folgt nicht „Bereich: was sich ändert“." };
const hinweis: Report = { level: "warning", message: "Code geändert, aber nichts in docs/: Beschreibt eine Doku-Seite das geänderte Verhalten?" };
const bot = (body: string, id = 7): Kommentar => ({ id, body, user: { login: "github-actions[bot]" } });

describe("ergebnisLesen", () => {
  it("nimmt das Ergebnis von pruefen.ts an", () => {
    expect(ergebnisLesen({ pr: 12, headSha: SHA, reports: [fehler, hinweis] })).toEqual({ pr: 12, headSha: SHA, reports: [fehler, hinweis] });
  });

  it.each([
    ["ohne Nummer", { headSha: SHA, reports: [] }],
    ["mit Nummer als Text", { pr: "12", headSha: SHA, reports: [] }],
    ["mit Bruchzahl als Nummer", { pr: 12.5, headSha: SHA, reports: [] }],
    ["ohne Commit", { pr: 12, headSha: "main", reports: [] }],
    ["ohne Liste", { pr: 12, headSha: SHA }],
    ["mit fremder Stufe", { pr: 12, headSha: SHA, reports: [{ level: "notice", message: "x" }] }],
    ["mit Meldung als Objekt", { pr: 12, headSha: SHA, reports: [{ level: "error", message: {} }] }],
    ["mit zu vielen Meldungen", { pr: 12, headSha: SHA, reports: Array(51).fill(hinweis) }],
    ["leer", null],
  ])("lehnt ein Ergebnis %s ab", (_, daten) => {
    expect(() => ergebnisLesen(daten)).toThrow();
  });
});

describe("entschaerfen", () => {
  it("benachrichtigt niemanden, der im Titel erwähnt wird", () => {
    expect(entschaerfen("Titel „@firsttris schau mal“")).not.toMatch(/@\w/);
  });

  it("lässt keinen Marker und kein HTML durch", () => {
    expect(entschaerfen(`${MARKER}<img src=x>`)).not.toContain("<");
  });

  it("macht aus mehreren Zeilen eine", () => {
    expect(entschaerfen("a\n\n## Überschrift\nb")).toBe("a ## Überschrift b");
  });

  it("kürzt lange Meldungen", () => {
    expect(entschaerfen("x".repeat(2000)).length).toBeLessThanOrEqual(500);
  });
});

describe("kommentarText", () => {
  it("trennt Fehler und Hinweise und nennt den Commit", () => {
    const text = kommentarText([hinweis, fehler], SHA);
    expect(text.startsWith(MARKER)).toBe(true);
    expect(text).toContain(`**Fehler**`);
    expect(text).toContain(`**Hinweise**`);
    expect(text.indexOf(fehler.message)).toBeLessThan(text.indexOf(hinweis.message));
    expect(text).toContain("0123456");
  });

  it("lässt eine leere Gruppe weg", () => {
    expect(kommentarText([hinweis], SHA)).not.toContain("**Fehler**");
  });

  it("sagt ohne Meldungen, dass nichts mehr offen ist", () => {
    expect(kommentarText([], SHA)).toContain("Keine Fehler und keine Hinweise mehr.");
  });
});

describe("eigenerKommentar", () => {
  it("findet den Kommentar des Workflows", () => {
    const eigener = bot(`${MARKER}\nalt`, 3);
    expect(eigenerKommentar([bot("anderer Bot-Kommentar", 1), eigener])).toBe(eigener);
  });

  it("übernimmt keinen Kommentar, in den jemand den Marker kopiert hat", () => {
    expect(eigenerKommentar([{ id: 1, body: MARKER, user: { login: "jemand" } }])).toBeNull();
  });
});

describe("aktion", () => {
  it("legt bei Hinweisen einen Kommentar an", () => {
    expect(aktion([hinweis], SHA, null)).toEqual({ art: "anlegen", text: kommentarText([hinweis], SHA) });
  });

  it("legt ohne Meldungen keinen an", () => {
    expect(aktion([], SHA, null)).toEqual({ art: "nichts" });
  });

  it("ändert den vorhandenen, statt einen neuen anzulegen", () => {
    expect(aktion([fehler], SHA, bot(kommentarText([hinweis], SHA)))).toEqual({ art: "aendern", id: 7, text: kommentarText([fehler], SHA) });
  });

  it("setzt einen alten Kommentar auf „nichts mehr offen“, wenn alles behoben ist", () => {
    expect(aktion([], SHA, bot(kommentarText([hinweis], SHA)))).toEqual({ art: "aendern", id: 7, text: kommentarText([], SHA) });
  });

  it("lässt einen gleichen Kommentar stehen", () => {
    expect(aktion([hinweis], SHA, bot(kommentarText([hinweis], SHA)))).toEqual({ art: "nichts" });
  });
});
