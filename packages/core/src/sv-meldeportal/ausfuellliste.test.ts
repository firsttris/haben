import { describe, expect, it } from "vitest";
import { type LohnStammdaten, lohnabrechnung } from "../lohnabrechnung/index.ts";
import {
  abmeldung,
  anmeldung,
  beitragsnachweis,
  einzugsstelle,
  type Feld,
  jahresmeldung,
  MINIJOB_ZENTRALE,
  meldungen,
  type SvAbrechnung,
  type SvPerson,
  vollerEuro,
} from "./index.ts";

const LOHN: LohnStammdaten = {
  art: "beschaeftigt",
  monatsgehalt: 4000_00,
  eintritt: "2026-01-01",
  austritt: null,
  steuerklasse: 1,
  faktor: 1000,
  kinderfreibetraege: 0,
  konfession: null,
  kv: { art: "gesetzlich", zusatzbeitrag: 290 },
  pflege: { kinderlosenzuschlag: true, kinderUnter25: 0 },
  umlagen: { u1: 160, u2: 44 },
  minijob: { rvBefreit: false, pauschsteuer: true },
};

const ANGESTELLT: SvPerson = {
  personalnummer: 1,
  vorname: "Erika",
  nachname: "Muster",
  strasse: "Hauptstraße 5",
  plz: "77815",
  ort: "Bühl",
  geburtsdatum: "1990-03-15",
  steuerId: "65929970489",
  svNummer: "15150390M005",
  krankenkasse: "Techniker Krankenkasse",
  krankenkasseBetriebsnummer: "15027365",
  personengruppe: "101",
  beitragsgruppen: "1111",
  taetigkeitsschluessel: "431143112",
  lohn: LOHN,
};

const MINIJOBBER: SvPerson = {
  ...ANGESTELLT,
  personalnummer: 2,
  vorname: "Max",
  svNummer: "15150390M013",
  personengruppe: "109",
  beitragsgruppen: "6100",
  lohn: { ...LOHN, art: "minijob", monatsgehalt: 520_00, umlagen: { u1: 0, u2: 0 } },
};

function abrechnung(person: SvPerson, jahr: number, monat: number, entgelt?: number): SvAbrechnung {
  const r = lohnabrechnung({ jahr, monat, stammdaten: person.lohn, bundesland: "BW", ...(entgelt ? { entgelt } : {}) });
  if (!r.ok) throw new Error(r.meldung);
  return { jahr, monat, person, svBrutto: r.svBrutto, sv: r.sv };
}

const wert = (felder: Feld[], name: string) => felder.find((f) => f.name === name)?.wert;
const alleFelder = (m: { abschnitte: { felder: Feld[] }[] }) => m.abschnitte.flatMap((a) => a.felder);
const cent = (text: string | undefined) => Math.round(Number(text?.replace(",", ".")) * 100);

describe("Beitragsnachweis", () => {
  it("summiert je Beitragsgruppe und Umlage, Gesamtsumme gleich allen Anteilen", () => {
    const a = abrechnung(ANGESTELLT, 2026, 11);
    const b = abrechnung({ ...ANGESTELLT, personalnummer: 3, vorname: "Eva" }, 2026, 11, 2500_00);
    const bn = beitragsnachweis({
      jahr: 2026,
      monat: 11,
      einzugsstelle: einzugsstelle(ANGESTELLT)!,
      abrechnungen: [a, b],
      ohneAbrechnung: [],
      steuernummer: "",
    });
    const felder = alleFelder(bn);
    expect(wert(felder, "Betriebsnummer der Einzugsstelle")).toBe("15027365");
    expect(wert(felder, "Zeitraum von")).toBe("01.11.2026");
    expect(wert(felder, "Zeitraum bis")).toBe("30.11.2026");
    expect(bn.formular).toBe("Beitragsnachweis › Beitragsnachweis (Allgemein, Knappschaft, See)");
    const beitraege = bn.abschnitte[1]!.felder;
    expect(beitraege.map((f) => f.schluessel ?? "")).toEqual(["1000", "", "0100", "0010", "0001", "", "", "0050"]);
    expect(cent(beitraege[0]!.wert)).toBe(a.sv.kv.an + a.sv.kv.ag + b.sv.kv.an + b.sv.kv.ag);
    expect(cent(beitraege[4]!.wert)).toBe(a.sv.pv.an + a.sv.pv.ag + b.sv.pv.an + b.sv.pv.ag);
    const summe = beitraege.reduce((s, f) => s + cent(f.wert), 0);
    expect(summe).toBe(bn.summe);
    expect(bn.summe).toBe(a.sv.arbeitnehmer + a.sv.arbeitgeber + b.sv.arbeitnehmer + b.sv.arbeitgeber);
    expect(wert(felder, "Gesamtsumme")).toBe(`${Math.floor(bn.summe / 100)},${String(bn.summe % 100).padStart(2, "0")}`);
    expect(bn.termine.nachweisBis).toBe("2026-11-23");
    expect(bn.hinweise).toEqual([]);
    expect(bn.gegenstand).toBe("beitragsnachweis:2026-11:15027365");
  });

  it("weist im Minijob Pauschalen, RV nach Befreiung getrennt und die Pauschsteuer mit Steuernummer aus", () => {
    const pflichtig = abrechnung(MINIJOBBER, 2026, 11);
    const befreit = abrechnung(
      { ...MINIJOBBER, personalnummer: 4, beitragsgruppen: "6500", lohn: { ...MINIJOBBER.lohn, minijob: { rvBefreit: true, pauschsteuer: true } } },
      2026,
      11,
    );
    const bn = beitragsnachweis({
      jahr: 2026,
      monat: 11,
      einzugsstelle: MINIJOB_ZENTRALE,
      abrechnungen: [pflichtig, befreit],
      ohneAbrechnung: [],
      steuernummer: "35/123/45678",
    });
    const felder = alleFelder(bn);
    expect(bn.formular).toBe("Beitragsnachweis › Beitragsnachweis geringfügig Beschäftigte");
    expect(wert(felder, "Betriebsnummer der Einzugsstelle")).toBe("98000006");
    expect(wert(felder, "Steuernummer des Arbeitgebers")).toBe("35/123/45678");
    // 520 € × 18,6 % = 96,72 € voll; befreit nur 15 % = 78,00 €
    expect(wert(felder, "Beiträge zur Rentenversicherung, voller Beitrag")).toBe("96,72");
    expect(wert(felder, "Pauschalbeiträge zur Rentenversicherung für geringfügig Beschäftigte")).toBe("78,00");
    // 13 % KV-Pauschale je 520 € = 67,60 €, zweimal
    expect(wert(felder, "Pauschalbeiträge zur Krankenversicherung für geringfügig Beschäftigte")).toBe("135,20");
    // 2 % Pauschsteuer je 520 € = 10,40 €, zweimal
    expect(wert(felder, "Einheitliche Pauschsteuer")).toBe("20,80");
    const beitraege = bn.abschnitte[1]!.felder;
    expect(beitraege.reduce((s, f) => s + cent(f.wert), 0)).toBe(bn.summe);
  });

  it("nennt fehlende Abrechnungen und Schlüssel, die nicht zur Rechnung passen, statt zu raten", () => {
    const abweichend = { ...ANGESTELLT, beitragsgruppen: "3111" };
    const bn = beitragsnachweis({
      jahr: 2026,
      monat: 11,
      einzugsstelle: einzugsstelle(ANGESTELLT)!,
      abrechnungen: [abrechnung(abweichend, 2026, 11)],
      ohneAbrechnung: ["Eva Muster"],
      steuernummer: "",
    });
    expect(bn.hinweise[0]).toContain("Ohne festgeschriebene Abrechnung nicht enthalten: Eva Muster");
    expect(bn.hinweise[1]).toBe(
      "Erika Muster: Der Beitragsgruppenschlüssel in den Stammdaten ist 3111, Haben hat aber mit 1111 gerechnet. Prüfen, bevor du abtippst.",
    );
  });

  it("meldet eine fehlende Betriebsnummer der Kasse als fehlende Pflichtangabe", () => {
    const ohne = { ...ANGESTELLT, krankenkasseBetriebsnummer: "" };
    const bn = beitragsnachweis({ jahr: 2026, monat: 11, einzugsstelle: einzugsstelle(ohne)!, abrechnungen: [], ohneAbrechnung: [], steuernummer: "" });
    expect(bn.abschnitte[0]!.felder[0]).toMatchObject({ name: "Betriebsnummer der Einzugsstelle", wert: "", fehlt: true });
  });
});

describe("DEÜV-Meldungen", () => {
  const eingabe = (person: SvPerson, abrechnungen: SvAbrechnung[] = [], zahltage: string[] = []) => ({
    employeeId: "e1",
    person,
    abrechnungen,
    zahltage,
    steuernummer: "35/123/45678",
  });

  it("rundet auf volle Euro wie § 5 Abs. 4 DEÜV", () => {
    expect(vollerEuro(1234_49)).toBe("1234");
    expect(vollerEuro(1234_50)).toBe("1235");
    expect(vollerEuro(0)).toBe("0");
  });

  it("Anmeldung mit Meldegrund 10, Stammdaten, Schlüsseln und Frist; Staatsangehörigkeit offen statt geraten", () => {
    const m = anmeldung(eingabe({ ...ANGESTELLT, lohn: { ...LOHN, eintritt: "2026-11-01" } }, [], ["2026-11-30"]));
    const felder = alleFelder(m);
    expect(m.formular).toBe("SV-Meldungen › Anmeldung › 10 Beginn der Beschäftigung");
    expect(wert(felder, "Meldegrund")).toBe("10");
    expect(wert(felder, "Beschäftigungszeit von")).toBe("01.11.2026");
    expect(wert(felder, "Versicherungsnummer")).toBe("15150390M005");
    expect(wert(felder, "Beitragsgruppe")).toBe("1111");
    expect(wert(felder, "Tätigkeitsschlüssel")).toBe("431143112");
    expect(felder.find((f) => f.name === "Staatsangehörigkeit")).toMatchObject({ wert: "" });
    expect(felder.find((f) => f.name === "Statuskennzeichen")).toMatchObject({ wert: "" });
    expect(m.frist).toBe("2026-11-30");
    expect(m.vollstaendig).toBe(true);
    expect(m.gegenstand).toBe("anmeldung:e1:2026-11-01");
  });

  it("fehlende Versicherungsnummer und Tätigkeitsschlüssel als Hinweis und unvollständig", () => {
    const m = anmeldung(eingabe({ ...ANGESTELLT, svNummer: "", taetigkeitsschluessel: "" }));
    expect(m.vollstaendig).toBe(false);
    expect(
      alleFelder(m)
        .filter((f) => f.fehlt)
        .map((f) => f.name),
    ).toEqual(["Versicherungsnummer", "Tätigkeitsschlüssel"]);
    expect(m.hinweise[0]).toContain("Ohne Versicherungsnummer");
  });

  it("Jahresmeldung mit dem RV-pflichtigen Entgelt des Jahres in vollen Euro", () => {
    const person = { ...ANGESTELLT, lohn: { ...LOHN, eintritt: "2026-10-01" } };
    const abr = [10, 11, 12].map((m) => abrechnung(person, 2026, m));
    const m = jahresmeldung(eingabe(person, abr, ["2027-01-29"]), 2026);
    const felder = alleFelder(m);
    expect(wert(felder, "Meldegrund")).toBe("50");
    expect(wert(felder, "Beschäftigungszeit von")).toBe("01.10.2026");
    expect(wert(felder, "Beschäftigungszeit bis")).toBe("31.12.2026");
    expect(wert(felder, "Beitragspflichtiges Bruttoarbeitsentgelt in Euro")).toBe("12000");
    expect(wert(felder, "Kennzeichen Übergangsbereich")).toBe("0");
    expect(felders(felder)).not.toContain("Entgelt Rentenberechnung in Euro");
    expect(m.frist).toBe("2027-01-29");
    expect(m.vollstaendig).toBe(true);
  });

  it("lässt das Entgelt leer, solange ein Monat ohne festgeschriebene Abrechnung ist", () => {
    const person = { ...ANGESTELLT, lohn: { ...LOHN, eintritt: "2026-10-01" } };
    const m = jahresmeldung(eingabe(person, [abrechnung(person, 2026, 10)]), 2026);
    expect(alleFelder(m).find((f) => f.name === "Beitragspflichtiges Bruttoarbeitsentgelt in Euro")).toMatchObject({ wert: "", fehlt: true });
    expect(m.hinweise[0]).toBe("Ohne festgeschriebene Abrechnung: 11/2026, 12/2026. Das Entgelt steht erst da, wenn alle Monate abgerechnet sind.");
    expect(m.vollstaendig).toBe(false);
  });

  it("meldet im Übergangsbereich die reduzierte Einnahme, Kennzeichen 1 und das Entgelt für die Rentenberechnung", () => {
    const person = { ...ANGESTELLT, lohn: { ...LOHN, monatsgehalt: 1200_00, eintritt: "2026-11-01" } };
    const abr = [11, 12].map((m) => abrechnung(person, 2026, m));
    const felder = alleFelder(jahresmeldung(eingabe(person, abr), 2026));
    const reduziert = abr.reduce((s, a) => s + a.sv.bemessung.rvAv, 0);
    expect(reduziert).toBeLessThan(2400_00);
    expect(wert(felder, "Beitragspflichtiges Bruttoarbeitsentgelt in Euro")).toBe(vollerEuro(reduziert));
    expect(wert(felder, "Kennzeichen Übergangsbereich")).toBe("1");
    expect(wert(felder, "Entgelt Rentenberechnung in Euro")).toBe("2400");
  });

  it("Abmeldung ab Jahresbeginn bis zum Ende, Minijob mit Angaben zur Steuer", () => {
    const person = { ...MINIJOBBER, lohn: { ...MINIJOBBER.lohn, eintritt: "2025-06-01", austritt: "2026-02-28" } };
    // 2025 hat Haben keine Werte; die Abmeldung braucht nur die Monate 2026
    const abr = [1, 2].map((m) => abrechnung(person, 2026, m));
    const m = abmeldung(eingabe(person, abr, ["2026-03-31"]))!;
    const felder = alleFelder(m);
    expect(m.formular).toBe("SV-Meldungen › Abmeldung › 30 Ende der Beschäftigung");
    expect(wert(felder, "Betriebsnummer der Einzugsstelle")).toBe("98000006");
    expect(wert(felder, "Beschäftigungszeit von")).toBe("01.01.2026");
    expect(wert(felder, "Beschäftigungszeit bis")).toBe("28.02.2026");
    expect(wert(felder, "Beitragspflichtiges Bruttoarbeitsentgelt in Euro")).toBe("1040");
    expect(wert(felder, "Steuernummer des Arbeitgebers")).toBe("35/123/45678");
    expect(wert(felder, "Steuer-ID des Beschäftigten")).toBe("65929970489");
    expect(wert(felder, "Art der Besteuerung")).toBe("Pauschsteuer 2 %");
    // Sechs Wochen nach dem 28. Februar wäre der 11. April; der nächste Zahltag kommt früher
    expect(m.frist).toBe("2026-03-31");
  });

  it("Minijob unter der Mindestbemessung: Entgelt offen statt geraten", () => {
    const person = { ...MINIJOBBER, lohn: { ...MINIJOBBER.lohn, monatsgehalt: 150_00, eintritt: "2026-12-01" } };
    const m = jahresmeldung(eingabe(person, [abrechnung(person, 2026, 12)]), 2026);
    expect(alleFelder(m).find((f) => f.name === "Beitragspflichtiges Bruttoarbeitsentgelt in Euro")).toMatchObject({ wert: "", fehlt: true });
    expect(m.hinweise.join(" ")).toContain("Mindestbeitragsbemessungsgrundlage");
  });

  it("meldungen: Anmeldung, Sofortmeldung, Jahresmeldungen bis zur Abmeldung; keine Jahresmeldung bei Ende am 31.12.", () => {
    const arten = (p: SvPerson, bis: number) => meldungen(eingabe(p), bis).map((m) => `${m.art} ${m.anlass}`);
    expect(arten({ ...ANGESTELLT, lohn: { ...LOHN, eintritt: "2025-07-01" } }, 2026)).toEqual([
      "anmeldung 2025-07-01",
      "sofortmeldung 2025-07-01",
      "jahresmeldung 2025-12-31",
      "jahresmeldung 2026-12-31",
    ]);
    expect(arten({ ...ANGESTELLT, lohn: { ...LOHN, eintritt: "2025-07-01", austritt: "2025-12-31" } }, 2026)).toEqual([
      "anmeldung 2025-07-01",
      "sofortmeldung 2025-07-01",
      "abmeldung 2025-12-31",
    ]);
    expect(meldungen(eingabe({ ...ANGESTELLT, lohn: { ...LOHN, art: "ggf" } }), 2026)).toEqual([]);
  });
});

const felders = (felder: Feld[]) => felder.map((f) => f.name);
