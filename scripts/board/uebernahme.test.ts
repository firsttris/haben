import { describe, expect, it } from "vitest";
import { befehl, entscheiden, faellig, GRENZE, type Lage, MARKE_ERINNERUNG, textErinnerung } from "./uebernahme.ts";

describe("befehl", () => {
  it.each([
    ["/übernehmen", "übernehmen"],
    ["/uebernehmen", "übernehmen"],
    ["Hallo!\n\n/Übernehmen bitte", "übernehmen"],
    ["  /freigeben  ", "freigeben"],
  ])("erkennt „%s“", (text, erwartet) => {
    expect(befehl(text)).toBe(erwartet);
  });

  it.each(["Ich würde das gern übernehmen", "Mit `/übernehmen` geht es", "```\n/freigeben\n```", "siehe /übernehmen-Regel", "x /übernehmen"])(
    "ignoriert „%s“",
    (text) => {
      expect(befehl(text)).toBeNull();
    },
  );
});

describe("entscheiden", () => {
  const lage = (teil: Partial<Lage> = {}): Lage => ({
    person: "anna",
    vertraut: false,
    offen: true,
    status: "Geplant",
    zugewiesen: [],
    andereZuweisungen: [],
    ...teil,
  });

  it("weist eine freie Karte aus „Geplant“ und „Später“ zu", () => {
    expect(entscheiden("übernehmen", lage())).toEqual({ art: "zuweisen" });
    expect(entscheiden("übernehmen", lage({ status: "Später" }))).toEqual({ art: "zuweisen" });
  });

  it("lehnt ab, wenn die Karte schon vergeben ist, und nennt, an wen", () => {
    const ergebnis = entscheiden("übernehmen", lage({ zugewiesen: ["bert"] }));
    expect(ergebnis).toMatchObject({ art: "ablehnen", text: expect.stringContaining("@bert") });
  });

  it("lehnt ab ohne Karte im Board, in Arbeit und bei Geschlossenem", () => {
    expect(entscheiden("übernehmen", lage({ status: null }))).toMatchObject({ art: "ablehnen", text: expect.stringContaining("noch nicht im") });
    expect(entscheiden("übernehmen", lage({ status: "Im nächsten Release" }))).toMatchObject({ art: "ablehnen" });
    expect(entscheiden("übernehmen", lage({ offen: false }))).toMatchObject({ art: "ablehnen" });
  });

  it(`hält die Grenze von ${GRENZE} Karten ein und nennt sie`, () => {
    const voll = lage({ andereZuweisungen: [12, 13] });
    expect(entscheiden("übernehmen", voll)).toMatchObject({ art: "ablehnen", text: expect.stringContaining("#12, #13") });
    expect(entscheiden("übernehmen", lage({ andereZuweisungen: [12] }))).toEqual({ art: "zuweisen" });
  });

  it("lässt Maintainer und Collaborators über die Grenze", () => {
    expect(entscheiden("übernehmen", lage({ vertraut: true, andereZuweisungen: [1, 2, 3] }))).toEqual({ art: "zuweisen" });
  });

  it("meldet, wenn es einem schon gehört", () => {
    expect(entscheiden("übernehmen", lage({ zugewiesen: ["anna"] }))).toMatchObject({ art: "ablehnen", text: expect.stringContaining("schon zugewiesen") });
  });

  it("gibt frei und schiebt die Karte nur zurück, wenn niemand mehr zugewiesen ist", () => {
    expect(entscheiden("freigeben", lage({ zugewiesen: ["anna"], status: "In Arbeit" }))).toEqual({ art: "freigeben", zurueckNachGeplant: true });
    expect(entscheiden("freigeben", lage({ zugewiesen: ["anna", "bert"], status: "In Arbeit" }))).toEqual({
      art: "freigeben",
      zurueckNachGeplant: false,
    });
    expect(entscheiden("freigeben", lage({ zugewiesen: ["anna"], status: "Im nächsten Release" }))).toEqual({
      art: "freigeben",
      zurueckNachGeplant: false,
    });
  });

  it("gibt nichts frei, was einem nicht gehört", () => {
    expect(entscheiden("freigeben", lage({ zugewiesen: ["bert"] }))).toMatchObject({ art: "ablehnen" });
  });
});

describe("faellig", () => {
  const tag = (n: number) => new Date(Date.UTC(2026, 10, 1 + n));
  const verlauf = { zugewiesenAm: tag(0), kommentareAm: [] as Date[], erinnertAm: null as Date | null, offenerPr: false };

  it("erinnert nach 14 Tagen ohne Lebenszeichen, nicht vorher", () => {
    expect(faellig(verlauf, tag(13))).toBeNull();
    expect(faellig(verlauf, tag(14))).toBe("erinnern");
  });

  it("zählt einen Kommentar der Person als Lebenszeichen", () => {
    expect(faellig({ ...verlauf, kommentareAm: [tag(10)] }, tag(20))).toBeNull();
    expect(faellig({ ...verlauf, kommentareAm: [tag(10)] }, tag(24))).toBe("erinnern");
  });

  it("gibt sieben Tage nach der Erinnerung frei, wenn nichts kam", () => {
    const erinnert = { ...verlauf, erinnertAm: tag(14) };
    expect(faellig(erinnert, tag(20))).toBeNull();
    expect(faellig(erinnert, tag(21))).toBe("freigeben");
  });

  it("fängt nach einer Antwort auf die Erinnerung von vorn an", () => {
    expect(faellig({ ...verlauf, erinnertAm: tag(14), kommentareAm: [tag(15)] }, tag(22))).toBeNull();
    expect(faellig({ ...verlauf, erinnertAm: tag(14), kommentareAm: [tag(15)] }, tag(29))).toBe("erinnern");
  });

  it("lässt Issues mit offenem Pull Request in Ruhe", () => {
    expect(faellig({ ...verlauf, offenerPr: true }, tag(60))).toBeNull();
  });
});

describe("textErinnerung", () => {
  it("trägt die Marke, damit der nächste Lauf die Erinnerung findet", () => {
    expect(textErinnerung(["anna"])).toContain(MARKE_ERINNERUNG);
    expect(textErinnerung(["anna"])).toContain("@anna");
  });
});
