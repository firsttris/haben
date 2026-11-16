import { describe, expect, it } from "vitest";
import { aenderungen, type Antworten, antwortenAus, einrichtungsAufgaben, fragenFehlen, offeneFragen, type Stand, steuerangabenNach } from "./einrichtung.ts";

const neu: Stand = {
  rechtsform: "einzelunternehmen",
  einkunftsart: null,
  kleinunternehmer: false,
  versteuerung: "ist",
  ohneVorsteuerabzug: false,
  kontenrahmen: "SKR03",
  voranmeldung: "monatlich",
  eingerichtet: false,
  firmendatenGespeichert: false,
  einrichtungOffen: [],
  ausgeblendet: [],
  hatMitarbeiter: false,
};

const nichts: Antworten = {
  selbstaendig: null,
  kleinunternehmer: null,
  versteuerung: null,
  voranmeldung: null,
  ohneVorsteuerabzug: null,
  kontenrahmen: null,
  bereiche: {},
};

describe("antwortenAus", () => {
  it("lässt beim ersten Mal alles offen, statt die Vorgaben als Antwort auszugeben", () => {
    expect(antwortenAus(neu)).toEqual(nichts);
  });

  it("nimmt beim ersten Mal vorhandene Mitarbeiter als Antwort für Personal", () => {
    expect(antwortenAus({ ...neu, hatMitarbeiter: true }).bereiche).toEqual({ personal: true });
  });

  it("füllt beim erneuten Durchgehen die gespeicherten Angaben vor", () => {
    const stand: Stand = {
      ...neu,
      einkunftsart: "selbstaendig",
      kleinunternehmer: false,
      versteuerung: "soll",
      voranmeldung: "vierteljaehrlich",
      kontenrahmen: "SKR04",
      eingerichtet: true,
      firmendatenGespeichert: true,
      ausgeblendet: ["kasse", "personal"],
    };
    expect(antwortenAus(stand)).toEqual({
      selbstaendig: "freiberufler",
      kleinunternehmer: false,
      versteuerung: "soll",
      voranmeldung: "vierteljaehrlich",
      ohneVorsteuerabzug: false,
      kontenrahmen: "SKR04",
      bereiche: { angebote: true, personal: false, kasse: false, lastschriften: true, anlagen: true },
    });
  });

  it("lässt offen, was mit „weiß ich nicht“ beantwortet ist", () => {
    const stand: Stand = { ...neu, eingerichtet: true, firmendatenGespeichert: false, einrichtungOffen: ["rechtsform", "kleinunternehmer"] };
    const antworten = antwortenAus(stand);
    expect(antworten.selbstaendig).toBeNull();
    expect(antworten.kleinunternehmer).toBeNull();
  });

  it("nennt GmbH und UG nach der Rechtsform, ohne Voranmeldung „keine“", () => {
    const stand: Stand = { ...neu, rechtsform: "ug", voranmeldung: "keine", eingerichtet: true, firmendatenGespeichert: true };
    expect(antwortenAus(stand)).toMatchObject({ selbstaendig: "ug", voranmeldung: null });
  });
});

describe("steuerangabenNach", () => {
  it("lässt ohne Antworten alles, wie es ist", () => {
    expect(steuerangabenNach(neu, nichts)).toEqual({
      rechtsform: "einzelunternehmen",
      einkunftsart: null,
      kleinunternehmer: false,
      versteuerung: "ist",
      ohneVorsteuerabzug: false,
      kontenrahmen: "SKR03",
      voranmeldung: "monatlich",
    });
  });

  it("schreibt Freiberufler und Gewerbe als Einzelunternehmen mit Einkunftsart", () => {
    expect(steuerangabenNach(neu, { ...nichts, selbstaendig: "freiberufler" })).toMatchObject({
      rechtsform: "einzelunternehmen",
      einkunftsart: "selbstaendig",
    });
    expect(steuerangabenNach(neu, { ...nichts, selbstaendig: "gewerbe" })).toMatchObject({ rechtsform: "einzelunternehmen", einkunftsart: "gewerbe" });
  });

  it("lässt die Einkunftsart einer GmbH stehen", () => {
    const stand = { ...neu, einkunftsart: "gewerbe" as const };
    expect(steuerangabenNach(stand, { ...nichts, selbstaendig: "gmbh" })).toMatchObject({ rechtsform: "gmbh", einkunftsart: "gewerbe" });
  });

  it("ändert beim Kleinunternehmer weder Versteuerung noch Voranmeldung", () => {
    const antworten: Antworten = { ...nichts, kleinunternehmer: true, versteuerung: "soll", voranmeldung: "vierteljaehrlich" };
    expect(steuerangabenNach(neu, antworten)).toMatchObject({ kleinunternehmer: true, versteuerung: "ist", voranmeldung: "monatlich" });
  });

  it("übernimmt Versteuerung, Voranmeldung, Vorsteuerabzug und Kontenrahmen", () => {
    const antworten: Antworten = {
      ...nichts,
      kleinunternehmer: false,
      versteuerung: "soll",
      voranmeldung: "vierteljaehrlich",
      ohneVorsteuerabzug: true,
      kontenrahmen: "SKR04",
    };
    expect(steuerangabenNach(neu, antworten)).toMatchObject({
      versteuerung: "soll",
      voranmeldung: "vierteljaehrlich",
      ohneVorsteuerabzug: true,
      kontenrahmen: "SKR04",
    });
  });
});

describe("aenderungen", () => {
  it("nennt jede geänderte Angabe mit altem und neuem Wert", () => {
    const nachher = steuerangabenNach(neu, { ...nichts, selbstaendig: "gmbh", kleinunternehmer: true });
    expect(aenderungen(neu, nachher)).toEqual([
      { feld: "Rechtsform", von: "Einzelunternehmen", nach: "GmbH" },
      { feld: "Kleinunternehmer", von: "nein", nach: "ja" },
    ]);
  });

  it("ist leer, wenn sich nichts ändert", () => {
    expect(aenderungen(neu, steuerangabenNach(neu, nichts))).toEqual([]);
  });
});

describe("offeneFragen", () => {
  it("merkt sich Rechtsform und Kleinunternehmer, wenn sie offen bleiben", () => {
    expect(offeneFragen(nichts)).toEqual(["rechtsform", "kleinunternehmer"]);
    expect(offeneFragen({ ...nichts, selbstaendig: "gewerbe", kleinunternehmer: false })).toEqual([]);
  });
});

describe("einrichtungsAufgaben", () => {
  it("erinnert an die Fragen, solange sie fehlen, danach an Offenes", () => {
    expect(einrichtungsAufgaben({ fehlt: true, offen: [] }).map((a) => a.to)).toEqual(["/einrichtung"]);
    expect(einrichtungsAufgaben({ fehlt: false, offen: ["kleinunternehmer"] }).map((a) => a.title)).toEqual(["Kleinunternehmer klären"]);
    expect(einrichtungsAufgaben({ fehlt: false, offen: [] })).toEqual([]);
  });
});

describe("fragenFehlen", () => {
  it("nur bei einer neuen Instanz, nicht bei einer von vor dem Update mit Firmendaten", () => {
    expect(fragenFehlen({ eingerichtet: false, firmendatenGespeichert: false, firmenname: "" })).toBe(true);
    expect(fragenFehlen({ eingerichtet: true, firmendatenGespeichert: false, firmenname: "" })).toBe(false);
    expect(fragenFehlen({ eingerichtet: false, firmendatenGespeichert: true, firmenname: "" })).toBe(false);
    expect(fragenFehlen({ eingerichtet: false, firmendatenGespeichert: false, firmenname: "Musterbetrieb" })).toBe(false);
  });
});
