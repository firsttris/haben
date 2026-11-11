import { describe, expect, it } from "vitest";
import { alsKommentar, auslesen, freigabe, type Plan, pruefen } from "./plan.ts";

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
    { art: "kommentar", issue: 644, text: "Danke! Damit wir es einordnen können, fehlt noch: …", grund: "Rückfrage" },
    { art: "zuweisen", issue: 424, person: "well100", kommentar: "@well100 gehört dir!", grund: "Übernahme mit Skizze" },
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
        { art: "löschen", issue: 2 },
      ],
    };
    const ergebnis = pruefen(falsch);
    expect("fehler" in ergebnis && ergebnis.fehler).toEqual([
      "Schritt 1: „status“ muss Später oder Geplant sein.",
      "Schritt 1: „bereich“ ist keiner von Bank und Kasse, Belege, Rechnungen, Steuern, Buchhaltung, Lohn, Umzug, Oberfläche, Plattform.",
      "Schritt 2: „person“ ist kein GitHub-Login.",
      "Schritt 3: unbekannte Art „löschen“.",
    ]);
  });

  it("lehnt Unsinn ab", () => {
    expect(pruefen(null)).toHaveProperty("fehler");
    expect(pruefen({ zusammenfassung: "x", schritte: "nein" })).toHaveProperty("fehler");
  });
});

describe("alsKommentar und auslesen", () => {
  const text = alsKommentar(plan, "https://github.com/firsttris/haben/actions/runs/1");

  it("zeigt Tabelle, Wortlaut und Fragen", () => {
    expect(text).toContain("| 1 | #653 | Karte: Geplant, nach #634 | S · Belege | Fehler beim Storno |");
    expect(text).toContain("| 3 | #424 | zuweisen an @well100 |");
    expect(text).toContain("> @well100 gehört dir!");
    expect(text).toContain("- #654: FinTS-Registrierung beantragen?");
  });

  it("liest genau den Plan zurück, der angezeigt wird", () => {
    expect(auslesen(text)).toEqual(plan);
  });

  it("findet ohne Marke keinen Plan", () => {
    expect(auslesen("Nur Text")).toBeNull();
  });

  it("maskiert senkrechte Striche in Zellen", () => {
    const mitStrich: Plan = { zusammenfassung: "", schritte: [{ art: "kommentar", issue: 1, text: "x", grund: "a | b" }] };
    expect(alsKommentar(mitStrich, "")).toContain("a \\| b");
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
