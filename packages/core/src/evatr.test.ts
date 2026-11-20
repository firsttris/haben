import { describe, expect, it } from "vitest";
import {
  evatrAnfrage,
  evatrAntwortSchema,
  evatrFrisch,
  evatrFrischGueltig,
  evatrQualifiziertBestaetigt,
  evatrGueltig,
  evatrMeldung,
  evatrNachweis,
  evatrNeuNoetig,
  evatrPruefbar,
  evatrWort,
  evatrZeitpunkt,
  type EvatrKontakt,
  type EvatrStand,
} from "./evatr.ts";

const kontakt: EvatrKontakt = { ustId: "ATU12345678", name: "Musterhaus GmbH & Co KG", strasse: "Musterstrasse 22", plz: "12345", ort: "musterort" };

describe("evatrPruefbar", () => {
  it("fragt Nummern anderer Mitgliedstaaten mit passendem Aufbau an, auch Nordirland und GR als EL", () => {
    expect(evatrPruefbar("ATU12345678")).toBe(true);
    expect(evatrPruefbar("XI123456789")).toBe(true);
    expect(evatrPruefbar("GR123456789")).toBe(true);
    expect(evatrPruefbar("fr 12 345678901")).toBe(true);
  });

  it("lässt deutsche, britische, leere und falsch aufgebaute Nummern aus", () => {
    expect(evatrPruefbar("DE123456789")).toBe(false);
    expect(evatrPruefbar("GB123456789")).toBe(false);
    expect(evatrPruefbar("")).toBe(false);
    // Österreich: U und acht Ziffern (#1413)
    expect(evatrPruefbar("AT12345678")).toBe(false);
    expect(evatrPruefbar("US123456789")).toBe(false);
  });
});

describe("evatrAnfrage", () => {
  it("einfach nur mit den beiden Nummern, in der Schreibweise der Meldung", () => {
    expect(evatrAnfrage("de 123456789", { ...kontakt, ustId: "gr123456789" }, "einfach")).toEqual({
      anfragendeUstid: "DE123456789",
      angefragteUstid: "EL123456789",
    });
  });

  it("qualifiziert mit Name, Straße, PLZ und Ort wie im Beispiel der OpenAPI-Beschreibung", () => {
    expect(evatrAnfrage("DE123456789", kontakt, "qualifiziert")).toEqual({
      anfragendeUstid: "DE123456789",
      angefragteUstid: "ATU12345678",
      firmenname: "Musterhaus GmbH & Co KG",
      strasse: "Musterstrasse 22",
      plz: "12345",
      ort: "musterort",
    });
  });

  it("lässt leere Straße und PLZ weg, statt sie leer zu senden", () => {
    const anfrage = evatrAnfrage("DE123456789", { ...kontakt, strasse: " ", plz: "" }, "qualifiziert");
    expect(anfrage).toEqual({ anfragendeUstid: "DE123456789", angefragteUstid: "ATU12345678", firmenname: "Musterhaus GmbH & Co KG", ort: "musterort" });
    expect(JSON.stringify(anfrage)).not.toContain("strasse");
  });
});

describe("Antwort", () => {
  it("liest die Antworten der Testabfrage vom 2026-11-18", () => {
    // Echte Antworten auf die Beispielwerte der OpenAPI-Beschreibung (einfach und qualifiziert)
    const einfach = evatrAntwortSchema.parse({ id: "85912482a2d8f44d", anfrageZeitpunkt: "2026-11-18T14:34:36.318854732+01:00", status: "evatr-0000" });
    expect(einfach.ergFirmenname).toBeUndefined();
    const qualifiziert = evatrAntwortSchema.parse({
      id: "779b5f65af22c988",
      anfrageZeitpunkt: "2026-11-18T14:34:36.386770643+01:00",
      status: "evatr-0000",
      ergFirmenname: "A",
      ergStrasse: "A",
      ergPlz: "A",
      ergOrt: "A",
    });
    expect(qualifiziert.ergOrt).toBe("A");
  });

  it("lehnt einen Vergleich außerhalb von A bis D und einen fremden Status ab", () => {
    expect(evatrAntwortSchema.safeParse({ anfrageZeitpunkt: "x", status: "evatr-0000", ergOrt: "E" }).success).toBe(false);
    expect(evatrAntwortSchema.safeParse({ anfrageZeitpunkt: "x", status: "200" }).success).toBe(false);
  });

  it("versteht den Zeitpunkt mit Nanosekunden und Zeitzone", () => {
    expect(evatrZeitpunkt("2026-11-18T14:34:36.318854732+01:00")?.toISOString()).toBe("2026-11-18T13:34:36.318Z");
    expect(evatrZeitpunkt("2026-11-18T14:34:36Z")?.toISOString()).toBe("2026-11-18T14:34:36.000Z");
    expect(evatrZeitpunkt("18.11.2026 14:34")).toBeNull();
    expect(evatrZeitpunkt("2026-13-18T14:34:36Z")).toBeNull();
  });
});

describe("Status", () => {
  it("speichert nur Antworten zur Nummer als Nachweis", () => {
    for (const status of ["evatr-0000", "evatr-2001", "evatr-2002", "evatr-2006", "evatr-2008"]) expect(evatrNachweis(status)).toBe(true);
    // Syntax und Länderkennzeichen der angefragten Nummer (#1578): eine falsche Prüfziffer ergibt evatr-0005
    for (const status of ["evatr-0005", "evatr-0012", "evatr-2003"]) expect(evatrNachweis(status)).toBe(true);
    // Limit, eigene Nummer falsch oder ungültig, Dienst nicht verfügbar
    for (const status of ["evatr-0008", "evatr-0004", "evatr-2005", "evatr-1001", "evatr-2011"]) expect(evatrNachweis(status)).toBe(false);
  });

  it("gültig sind evatr-0000 und evatr-2008", () => {
    expect(evatrGueltig("evatr-0000")).toBe(true);
    expect(evatrGueltig("evatr-2008")).toBe(true);
    expect(evatrGueltig("evatr-2006")).toBe(false);
  });

  it("ein kurzes Wort je Antwort zur Nummer", () => {
    expect(["evatr-0000", "evatr-2008", "evatr-2001", "evatr-2002", "evatr-2006"].map(evatrWort)).toEqual([
      "Gültig",
      "Gültig",
      "Nicht vergeben",
      "Noch nicht gültig",
      "Nicht mehr gültig",
    ]);
    expect(["evatr-0005", "evatr-0012", "evatr-2003"].map(evatrWort)).toEqual(["Syntaktisch falsch", "Syntaktisch falsch", "Syntaktisch falsch"]);
  });

  it("nennt die Zeiträume aus gueltigAb und gueltigBis", () => {
    expect(evatrMeldung({ status: "evatr-2006", gueltigAb: "2020-01-01", gueltigBis: "2025-06-30" })).toBe(
      "Nicht mehr gültig; gültig war sie vom 2020-01-01 bis 2025-06-30",
    );
    expect(evatrMeldung({ status: "evatr-2002", gueltigAb: "2027-01-01" })).toBe("Noch nicht gültig, erst ab 2027-01-01");
    expect(evatrMeldung({ status: "evatr-1004" })).toContain("später");
  });
});

describe("evatrNeuNoetig", () => {
  const qualifiziert: EvatrStand = {
    art: "qualifiziert",
    angefragteUstid: "ATU12345678",
    status: "evatr-0000",
    firmenname: "Musterhaus GmbH & Co KG",
    strasse: "Musterstrasse 22",
    plz: "12345",
    ort: "musterort",
  };
  const einfach: EvatrStand = { art: "einfach", angefragteUstid: "ATU12345678", status: "evatr-0000", firmenname: null, strasse: null, plz: null, ort: null };

  it("fragt eine neue Nummer an, eine schon bestätigte mit denselben Angaben nicht", () => {
    expect(evatrNeuNoetig(kontakt, [])).toBe(true);
    expect(evatrNeuNoetig(kontakt, [qualifiziert, einfach])).toBe(false);
    expect(evatrNeuNoetig({ ...kontakt, ustId: "ATU87654321" }, [qualifiziert, einfach])).toBe(true);
  });

  it("fragt nach einer Änderung von Name oder Anschrift neu an", () => {
    expect(evatrNeuNoetig({ ...kontakt, strasse: "Neue Straße 1" }, [qualifiziert, einfach])).toBe(true);
    expect(evatrNeuNoetig({ ...kontakt, name: "Musterhaus AG" }, [qualifiziert, einfach])).toBe(true);
    // Nach Leerzeichen am Rand nicht: gesendet wird ohne
    expect(evatrNeuNoetig({ ...kontakt, ort: " musterort " }, [qualifiziert, einfach])).toBe(false);
  });

  it("zurück auf einen früheren Stand: Vergleich mit der letzten qualifizierten Bestätigung, nicht mit irgendeiner", () => {
    const zuB: EvatrStand = { ...qualifiziert, firmenname: "Musterhaus AG" };
    // Name erst A, dann B bestätigt, jetzt wieder A; neueste zuerst
    expect(evatrNeuNoetig(kontakt, [zuB, einfach, qualifiziert, einfach])).toBe(true);
  });

  it("nach einer nur einfachen Bestätigung, etwa beim Limit, beim nächsten Speichern mit Name und Ort", () => {
    expect(evatrNeuNoetig(kontakt, [einfach])).toBe(true);
    expect(evatrNeuNoetig({ ...kontakt, ort: "" }, [einfach])).toBe(false);
  });

  it("eine zuletzt ungültige Nummer nicht bei jedem Speichern, deutsche nie", () => {
    expect(evatrNeuNoetig({ ...kontakt, name: "Neu" }, [{ ...einfach, status: "evatr-2001" }, qualifiziert])).toBe(false);
    expect(evatrNeuNoetig({ ...kontakt, ustId: "DE123456789" }, [])).toBe(false);
  });
});

describe("evatrFrisch", () => {
  it("gilt 30 Tage ab dem Zeitpunkt beim BZSt, danach nicht mehr", () => {
    const jetzt = new Date("2026-12-18T12:00:00Z");
    expect(evatrFrisch("2026-11-18T12:00:00Z", jetzt)).toBe(true);
    expect(evatrFrisch(new Date("2026-11-18T11:59:59Z"), jetzt)).toBe(false);
    expect(evatrFrisch("2026-12-18T12:00:00Z", jetzt)).toBe(true);
  });
});

describe("evatrFrischGueltig", () => {
  it("nur eine gültige Antwort aus der Frist; evatr-2008 zählt als gültig", () => {
    const jetzt = new Date("2026-11-20T12:00:00Z");
    expect(evatrFrischGueltig({ status: "evatr-0000", anfrageZeitpunkt: "2026-11-18T12:00:00Z" }, jetzt)).toBe(true);
    expect(evatrFrischGueltig({ status: "evatr-2008", anfrageZeitpunkt: "2026-11-18T12:00:00Z" }, jetzt)).toBe(true);
    expect(evatrFrischGueltig({ status: "evatr-2001", anfrageZeitpunkt: "2026-11-18T12:00:00Z" }, jetzt)).toBe(false);
    expect(evatrFrischGueltig({ status: "evatr-0000", anfrageZeitpunkt: "2026-09-18T12:00:00Z" }, jetzt)).toBe(false);
    expect(evatrFrischGueltig(undefined, jetzt)).toBe(false);
  });
});

describe("evatrQualifiziertBestaetigt", () => {
  const jetzt = new Date("2026-11-20T12:00:00Z");
  const q = { art: "qualifiziert" as const, status: "evatr-0000", anfrageZeitpunkt: "2026-11-18T12:00:00Z", ergFirmenname: "A", ergOrt: "A" };
  it("für Reverse Charge: frisch, gültig, qualifiziert, Name und Ort nicht „stimmt nicht“", () => {
    expect(evatrQualifiziertBestaetigt(q, jetzt)).toBe(true);
    // D (vom Mitgliedstaat nicht mitgeteilt) ist kein Widerspruch
    expect(evatrQualifiziertBestaetigt({ ...q, ergOrt: "D" }, jetzt)).toBe(true);
    expect(evatrQualifiziertBestaetigt({ ...q, ergOrt: "B" }, jetzt)).toBe(false);
    expect(evatrQualifiziertBestaetigt({ ...q, ergFirmenname: "B" }, jetzt)).toBe(false);
    expect(evatrQualifiziertBestaetigt({ ...q, art: "einfach" }, jetzt)).toBe(false);
    expect(evatrQualifiziertBestaetigt({ ...q, anfrageZeitpunkt: "2026-09-18T12:00:00Z" }, jetzt)).toBe(false);
  });
});
