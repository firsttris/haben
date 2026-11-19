import { describe, expect, it } from "vitest";
import { bwaZeitraum, imZeitraum, jahreVon, kumuliert, vergleichszeitraum, vorjahreszeitraum, vorperiode } from "./bwa-zeitraum.ts";

describe("Zeiträume der BWA", () => {
  it("Monat, Quartal und Jahr", () => {
    expect(bwaZeitraum("monat", 2027, 2)).toEqual({ von: "2027-02-01", bis: "2027-02-28" });
    expect(bwaZeitraum("monat", 2028, 2)).toEqual({ von: "2028-02-01", bis: "2028-02-29" });
    expect(bwaZeitraum("quartal", 2027, 4)).toEqual({ von: "2027-10-01", bis: "2027-12-31" });
    expect(bwaZeitraum("jahr", 2027)).toEqual({ von: "2027-01-01", bis: "2027-12-31" });
  });

  it("Vorjahreszeitraum: dieselben Kalendertage", () => {
    expect(vorjahreszeitraum({ von: "2027-03-01", bis: "2027-05-15" })).toEqual({ von: "2026-03-01", bis: "2026-05-15" });
    // Ein freier Zeitraum bis zum 29. Februar endet im Vorjahr am 28.
    expect(vorjahreszeitraum({ von: "2028-02-10", bis: "2028-02-29" })).toEqual({ von: "2027-02-10", bis: "2027-02-28" });
  });

  it("Vorjahreszeitraum: ganze Monate bleiben ganze Monate, auch um den Schalttag", () => {
    expect(vorjahreszeitraum(bwaZeitraum("monat", 2028, 2))).toEqual({ von: "2027-02-01", bis: "2027-02-28" });
    expect(vorjahreszeitraum(bwaZeitraum("monat", 2029, 2))).toEqual({ von: "2028-02-01", bis: "2028-02-29" });
    expect(vorjahreszeitraum({ von: "2029-01-01", bis: "2029-02-28" })).toEqual({ von: "2028-01-01", bis: "2028-02-29" });
  });

  it("Vorperiode: der Monat, das Quartal, das Jahr davor; frei gleich viele Tage", () => {
    expect(vorperiode(bwaZeitraum("monat", 2027, 1))).toEqual({ von: "2026-12-01", bis: "2026-12-31" });
    expect(vorperiode(bwaZeitraum("monat", 2028, 3))).toEqual({ von: "2028-02-01", bis: "2028-02-29" });
    expect(vorperiode(bwaZeitraum("quartal", 2027, 1))).toEqual({ von: "2026-10-01", bis: "2026-12-31" });
    expect(vorperiode(bwaZeitraum("jahr", 2027))).toEqual({ von: "2026-01-01", bis: "2026-12-31" });
    expect(vorperiode({ von: "2027-03-01", bis: "2027-03-10" })).toEqual({ von: "2027-02-19", bis: "2027-02-28" });
  });

  it("kumuliert seit Beginn des Geschäftsjahres", () => {
    expect(kumuliert({ von: "2027-03-01", bis: "2027-05-15" })).toEqual({ von: "2027-01-01", bis: "2027-05-15" });
  });

  it("Vergleich nach Wahl", () => {
    const z = bwaZeitraum("quartal", 2027, 2);
    expect(vergleichszeitraum(z, "vorjahr")).toEqual(bwaZeitraum("quartal", 2026, 2));
    expect(vergleichszeitraum(z, "vorperiode")).toEqual(bwaZeitraum("quartal", 2027, 1));
    expect(vergleichszeitraum(z, "keiner")).toBeNull();
  });

  it("Grenzen eingeschlossen, berührte Jahre", () => {
    const z = { von: "2026-12-01", bis: "2027-01-31" };
    expect(imZeitraum(z, "2026-12-01")).toBe(true);
    expect(imZeitraum(z, "2027-01-31")).toBe(true);
    expect(imZeitraum(z, "2027-02-01")).toBe(false);
    expect(jahreVon(z)).toEqual([2026, 2027]);
  });
});
