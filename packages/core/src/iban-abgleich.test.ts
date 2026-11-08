import { describe, expect, it } from "vitest";
import { geltendeIban, gruppierteIban, ibanAbgleich } from "./iban-abgleich.ts";

const KONTAKT = "DE89370400440532013000";
const RECHNUNG = "DE02120300000000202051";

describe("IBAN-Abgleich am Beleg (#410)", () => {
  it("ohne IBAN in der E-Rechnung gibt es nichts abzugleichen", () => {
    expect(ibanAbgleich({ kontaktIban: KONTAKT, rechnungsIban: null }, [])).toEqual({ art: "keine" });
    expect(ibanAbgleich({ kontaktIban: null, rechnungsIban: null }, [])).toEqual({ art: "keine" });
  });

  it("ohne IBAN am Kontakt ist die IBAN der E-Rechnung nur ungeprüft, ohne Sperre", () => {
    expect(ibanAbgleich({ kontaktIban: null, rechnungsIban: RECHNUNG }, [])).toEqual({ art: "ungeprueft", rechnungsIban: RECHNUNG });
  });

  it("gleiche IBAN, auch anders geschrieben, ist kein Hinweis", () => {
    expect(ibanAbgleich({ kontaktIban: "de89 3704 0044 0532 0130 00", rechnungsIban: KONTAKT }, [])).toEqual({ art: "gleich" });
  });

  it("abweichende IBAN ohne Entscheidung ist offen", () => {
    expect(ibanAbgleich({ kontaktIban: KONTAKT, rechnungsIban: "DE02 1203 0000 0000 2020 51" }, [])).toEqual({
      art: "abweichend",
      kontaktIban: KONTAKT,
      rechnungsIban: RECHNUNG,
      entscheidung: null,
    });
  });

  it("die jüngste Entscheidung für genau dieses Paar gilt; eine für ein anderes Paar nicht", () => {
    const alt = { kontaktIban: "DE75512108001245126199", rechnungsIban: RECHNUNG, wahl: "e-rechnung" as const, am: new Date("2026-09-01"), von: "max" };
    const erst = { kontaktIban: KONTAKT, rechnungsIban: RECHNUNG, wahl: "e-rechnung" as const, am: new Date("2026-09-02"), von: "max" };
    const dann = { kontaktIban: KONTAKT, rechnungsIban: RECHNUNG, wahl: "kontakt" as const, am: new Date("2026-09-03"), von: "erika" };
    expect(ibanAbgleich({ kontaktIban: KONTAKT, rechnungsIban: RECHNUNG }, [alt])).toMatchObject({ art: "abweichend", entscheidung: null });
    expect(ibanAbgleich({ kontaktIban: KONTAKT, rechnungsIban: RECHNUNG }, [dann, erst, alt])).toMatchObject({ art: "abweichend", entscheidung: dann });
    // Ändert sich die IBAN des Kontakts, ist neu zu entscheiden
    expect(ibanAbgleich({ kontaktIban: "DE44500105175407324931", rechnungsIban: RECHNUNG }, [dann, erst])).toMatchObject({ entscheidung: null });
  });

  it("geltende IBAN: Kontakt, bei Gleichheit der Kontakt, ungeprüft die E-Rechnung, abweichend nur mit Entscheidung", () => {
    expect(geltendeIban({ kontaktIban: KONTAKT, rechnungsIban: null }, [])).toEqual({ iban: KONTAKT, herkunft: "kontakt" });
    expect(geltendeIban({ kontaktIban: null, rechnungsIban: RECHNUNG }, [])).toEqual({ iban: RECHNUNG, herkunft: "e-rechnung" });
    expect(geltendeIban({ kontaktIban: null, rechnungsIban: null }, [])).toEqual({ iban: null, herkunft: null });
    expect(geltendeIban({ kontaktIban: KONTAKT, rechnungsIban: KONTAKT }, [])).toEqual({ iban: KONTAKT, herkunft: "kontakt" });
    expect(geltendeIban({ kontaktIban: KONTAKT, rechnungsIban: RECHNUNG }, [])).toEqual({ iban: null, herkunft: null, offen: true });
    const wahl = (w: "kontakt" | "e-rechnung") => [{ kontaktIban: KONTAKT, rechnungsIban: RECHNUNG, wahl: w, am: new Date(), von: "max" }];
    expect(geltendeIban({ kontaktIban: KONTAKT, rechnungsIban: RECHNUNG }, wahl("kontakt"))).toEqual({ iban: KONTAKT, herkunft: "kontakt", entschieden: true });
    expect(geltendeIban({ kontaktIban: KONTAKT, rechnungsIban: RECHNUNG }, wahl("e-rechnung"))).toEqual({
      iban: RECHNUNG,
      herkunft: "e-rechnung",
      entschieden: true,
    });
  });

  it("gruppiert in Vierergruppen", () => {
    expect(gruppierteIban("de02120300000000202051")).toBe("DE02 1203 0000 0000 2020 51");
  });
});
