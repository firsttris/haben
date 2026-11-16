import { describe, expect, it } from "vitest";
import mitKontoart from "../../test-fixtures/sevdesk/buchhaltung-1.0/asset-mit-kontoart.json" with { type: "json" };
import assetsV1 from "../../test-fixtures/sevdesk/buchhaltung-1.0/asset.json" with { type: "json" };
import assetsV2 from "../../test-fixtures/sevdesk/buchhaltung-2.0/asset.json" with { type: "json" };
import { takeoverProblems } from "../csv-import/assets.ts";
import { mapSevAsset, sevAnlageKeys, sevAnlageNotiz, sevAnlageRow, sevKontoHinweis } from "./anlagen.ts";
import { type SevAsset, sevAssetSchema } from "./types.ts";

/* Anlagenverzeichnis aus sevDesk (#472): anonymisierte Antworten von GET /Asset?embed=accountingType, Version 1.0 */

const STICHTAG = "2026-01-01";
const parsed = mitKontoart.objects.map((a) => sevAssetSchema.parse(a));
const byId = (id: string) => mapSevAsset(parsed.find((a) => a.id === id)!, STICHTAG);

/** Linear und monatsgenau (§ 7 Abs. 1 Satz 4 EStG): Monate vom Anschaffungsmonat bis zum 31.12. des Vorjahres */
const linearRest = (cost: number, months: number, life: number) => cost - Math.round((cost * months) / life);

describe("Anlagen aus sevDesk, Buchhaltung 1.0", () => {
  it("liest jede Antwort mit dem Schema", () => {
    for (const a of [...mitKontoart.objects, ...assetsV1.objects, ...assetsV2.objects]) expect(sevAssetSchema.safeParse(a).success).toBe(true);
  });

  it("Pkw: Art aus dem Buchungskonto, Restbuchwert linear zum Stichtag, Konto wie in sevDesk", () => {
    const pkw = byId("ID_1");
    expect(pkw).toMatchObject({ stand: "uebernehmen", kind: "kfz", method: "linear", usefulLifeMonths: 84, cost: 1_200_000, hinweise: [] });
    // Mai 2024 bis Dezember 2025: 20 Monate
    expect(pkw.openingBookValue).toBe(linearRest(1_200_000, 20, 84));
    expect(pkw.sevKonto).toEqual({ SKR03: "0320", SKR04: "0520" });
    expect(sevKontoHinweis(pkw, "kfz", "SKR03")).toBeNull();
    expect(sevKontoHinweis(pkw, "kfz", "SKR04")).toBeNull();
    expect(sevKontoHinweis(pkw, "sonstiges", "SKR04")).toBe("sevDesk führte die Anlage auf 0520, Haben bucht sie auf 0690");
  });

  it("eigene Kategorien: Art aus dem Namen", () => {
    const bga = byId("ID_6");
    expect(bga).toMatchObject({ stand: "uebernehmen", kind: "sonstiges", usefulLifeMonths: 36, sevKonto: null });
    expect(bga.openingBookValue).toBe(linearRest(100_000, 26, 36));
    expect(bga.hinweise).toEqual([]);
    const transport = byId("ID_9");
    expect(transport).toMatchObject({ stand: "uebernehmen", kind: "transport", openingBookValue: linearRest(360_000, 21, 84) });
  });

  it("Aufwandskategorie mit Nutzungsdauer: Art bleibt offen", () => {
    const drucker = byId("ID_12");
    expect(drucker).toMatchObject({ stand: "uebernehmen", kind: null, openingBookValue: linearRest(40_000, 33, 36) });
    expect(drucker.hinweise[0]).toBe("Art wählen: Die Kategorie „Kleingeräte“ in sevDesk legt sie nicht fest");
  });

  it("Nutzungsdauer 0 mit Status 500: GWG, nichts zu übernehmen", () => {
    expect(byId("ID_4")).toMatchObject({ stand: "erledigt", method: "gwg", openingBookValue: 0 });
  });

  it("Zeile für die Übernahme besteht die Prüfung der Übernahme", () => {
    for (const id of ["ID_1", "ID_6", "ID_9", "ID_12"]) {
      const anlage = byId(id);
      const row = sevAnlageRow(anlage, anlage.kind ?? "edv", STICHTAG);
      expect(takeoverProblems(row)).toEqual([]);
      expect(sevAnlageKeys(row.note)).toEqual([{ label: "sevDesk-Anlage ID", value: id.toLowerCase() }]);
    }
    expect(() => sevAnlageRow(byId("ID_4"), "edv", STICHTAG)).toThrow();
  });
});

describe("Grenzfälle", () => {
  const pkw = parsed.find((a) => a.id === "ID_1")!;
  const variante = (patch: Partial<SevAsset>) => mapSevAsset({ ...pkw, ...patch }, STICHTAG);

  it("nur zum 01.01.", () => {
    expect(() => mapSevAsset(pkw, "2026-03-01")).toThrow();
  });

  it("am oder nach dem Stichtag angeschafft: kein Vorschlag", () => {
    expect(variante({ acquisitionDate: "2026-01-01T00:00:00+01:00" })).toMatchObject({ stand: "ausgeschlossen" });
  });

  it("vor dem Stichtag verkauft: erledigt; danach: übernehmen mit Hinweis", () => {
    expect(variante({ saleDate: "2025-06-30T00:00:00+02:00" })).toMatchObject({ stand: "erledigt", grund: "Am 30.06.2025 abgegangen" });
    expect(variante({ saleDate: "2026-02-01T00:00:00+01:00" }).hinweise).toContain(
      "In sevDesk am 01.02.2026 verkauft: Abgang nach dem Übernehmen auf der Seite der Anlage eintragen",
    );
  });

  it("voll abgeschrieben: erledigt", () => {
    expect(variante({ acquisitionDate: "2018-01-10T00:00:00+01:00" })).toMatchObject({ stand: "erledigt", openingBookValue: 0 });
  });

  it("unbekannter Status, abweichender Buchungsbetrag, Gebäude, sofort abgeschrieben über 800 €: nicht raten", () => {
    expect(variante({ status: "200" }).stand).toBe("ausgeschlossen");
    expect(variante({ purchasePriceAccounting: "11000.00" }).stand).toBe("ausgeschlossen");
    expect(variante({ usefulLife: "0", status: "500" })).toMatchObject({
      stand: "ausgeschlossen",
      grund: "Sofort abgeschrieben, aber über 800 € netto: in sevDesk prüfen",
    });
    expect(variante({ usefulLife: "2.5" }).stand).toBe("ausgeschlossen");
    const gebaeude = { ...pkw.accountingType!, translationCode: "ACCOUNTING_TYPE_BUILDINGS" };
    expect(variante({ accountingType: gebaeude })).toMatchObject({ stand: "ausgeschlossen", grund: "Gebäude führt Haben nicht im Anlagenverzeichnis" });
  });

  it("Nutzungsdauer 1 Jahr: linear über 12 Monate mit Hinweis", () => {
    const einJahr = variante({ usefulLife: "1", acquisitionDate: "2025-10-01T00:00:00+02:00" });
    expect(einJahr).toMatchObject({ stand: "uebernehmen", usefulLifeMonths: 12, openingBookValue: 900_000 });
    expect(einJahr.hinweise[0]).toMatch(/^Nutzungsdauer 1 Jahr/);
  });

  it("Buchhaltung 2.0: Konto nur als accountDatev, Art bleibt offen", () => {
    const v2 = mapSevAsset(sevAssetSchema.parse({ ...assetsV2.objects[0], usefulLife: "5", status: "100" }), STICHTAG);
    expect(v2.kind).toBeNull();
    expect(v2.hinweise[0]).toBe("Art wählen: Das Konto aus sevDesk (Buchhaltung 2.0) liest Haben nicht aus");
  });

  it("Notiz und Schlüssel passen zusammen", () => {
    expect(sevAnlageKeys(sevAnlageNotiz({ nummer: "1019", sevId: "827" }))).toEqual([{ label: "sevDesk-Anlage ID", value: "827" }]);
    expect(sevAnlageKeys("Inventar 4")).toEqual([]);
  });
});
