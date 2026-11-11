import { describe, expect, it } from "vitest";
import { alsKommentar, auslesen, automatisch, freigabe, type Plan, pruefen } from "./plan.ts";

const plan: Plan = {
  zusammenfassung: "Zwei neue Issues, eine Übernahme.",
  schritte: [
    {
      art: "karte",
      issue: 653,
      status: "Geplant",
      nach: 634,
      aufwand: "S",
      bereich: "Belege",
      hinweis: "",
      einstieg: false,
      kommentar: "Danke! Ist jetzt im Board.",
      grund: "Fehler beim Storno",
    },
    { art: "kommentar", typ: "rückfrage", issue: 644, text: "Danke! Damit wir es einordnen können, fehlt noch: …", grund: "Angaben fehlen" },
    { art: "zuweisen", issue: 424, person: "well100", kommentar: "@well100 gehört dir!", grund: "Übernahme mit Skizze" },
    { art: "kommentar", typ: "nicht-geplant", issue: 497, text: "Danke! Das planen wir nicht: …", grund: "Bewusst nicht" },
    { art: "frage", issue: 654, text: "FinTS-Registrierung beantragen?" },
  ],
};

describe("pruefen", () => {
  it("nimmt einen gültigen Plan an", () => {
    expect(pruefen(plan)).toEqual({ plan });
  });

  it("nennt je Schritt, was falsch ist", () => {
    const falsch = {
      zusammenfassung: "x",
      schritte: [
        { ...plan.schritte[0], status: "In Arbeit", bereich: "Küche" },
        { art: "zuweisen", issue: 1, person: "a b; rm -rf", kommentar: "x", grund: "x" },
        { art: "kommentar", typ: "schließen", issue: 2, text: "x", grund: "x" },
        { art: "löschen", issue: 3 },
      ],
    };
    const ergebnis = pruefen(falsch);
    expect("fehler" in ergebnis && ergebnis.fehler).toEqual([
      "Schritt 1: „status“ muss Später oder Geplant sein.",
      "Schritt 1: „bereich“ ist keiner von Bank und Kasse, Belege, Rechnungen, Steuern, Buchhaltung, Lohn, Umzug, Oberfläche, Plattform.",
      "Schritt 2: „person“ ist kein GitHub-Login.",
      "Schritt 3: „typ“ ist keiner von rückfrage, antwort, nicht-geplant, duplikat, erledigt.",
      "Schritt 4: unbekannte Art „löschen“.",
    ]);
  });

  it("lehnt Unsinn ab", () => {
    expect(pruefen(null)).toHaveProperty("fehler");
    expect(pruefen({ zusammenfassung: "x", schritte: "nein" })).toHaveProperty("fehler");
  });
});

describe("automatisch", () => {
  it("macht nur Karten und Rückfragen ohne OK", () => {
    expect(plan.schritte.map(automatisch)).toEqual([true, true, false, false, false]);
  });
});

describe("alsKommentar und auslesen", () => {
  const erledigt = new Map([
    [1, "✓ Karte: Geplant, nach #634"],
    [2, "✓ kommentiert"],
  ]);
  const text = alsKommentar(plan, "https://github.com/firsttris/haben/actions/runs/1", erledigt, [3, 4]);

  it("trennt Erledigtes und was wartet, mit Wortlaut und Fragen", () => {
    expect(text).toContain("### Erledigt");
    expect(text).toContain("| 1 | #653 | Karte: Geplant, nach #634 (S · Belege) | ✓ Karte: Geplant, nach #634 |");
    expect(text).toContain("### Wartet auf dich");
    expect(text).toContain("| 3 | #424 | zuweisen an @well100 | Übernahme mit Skizze |");
    expect(text).toContain("| 4 | #497 | Kommentar (nicht-geplant) | Bewusst nicht |");
    expect(text).toContain("> @well100 gehört dir!");
    expect(text).not.toContain("> Danke! Ist jetzt im Board.");
    expect(text).toContain("- #654: FinTS-Registrierung beantragen?");
  });

  it("liest genau den Plan und die offenen Nummern zurück, die angezeigt werden", () => {
    expect(auslesen(text)).toEqual({ plan, offen: [3, 4] });
  });

  it("zeigt ohne Wartendes keinen Hinweis auf /ok", () => {
    expect(alsKommentar(plan, "", erledigt, [])).not.toContain("`/ok`");
  });

  it("findet ohne Marke keinen Plan", () => {
    expect(auslesen("Nur Text")).toBeNull();
  });

  it("maskiert senkrechte Striche in Zellen", () => {
    const mitStrich: Plan = { zusammenfassung: "", schritte: [{ art: "kommentar", typ: "antwort", issue: 1, text: "x", grund: "a | b" }] };
    expect(alsKommentar(mitStrich, "", new Map(), [1])).toContain("a \\| b");
  });
});

describe("freigabe", () => {
  it.each([
    ["/ok", { art: "ok", ohne: [] }],
    ["/OK ohne 2, 5", { art: "ok", ohne: [2, 5] }],
    ["/ok ohne 3 und 4", { art: "ok", ohne: [3, 4] }],
    ["/überarbeiten #653 lieber nach Später", { art: "überarbeiten", wunsch: "#653 lieber nach Später" }],
  ])("liest „%s“", (text, erwartet) => {
    expect(freigabe(text)).toEqual(erwartet);
  });

  it("ignoriert alles andere", () => {
    expect(freigabe("Sieht gut aus, /ok")).toBeNull();
    expect(freigabe("okay")).toBeNull();
  });
});
