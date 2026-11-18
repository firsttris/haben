import { createHash } from "node:crypto";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FELDER } from "./felder.ts";
import { SETTINGS_EXPORT_VERSION } from "./format.ts";

describe("Felder des Einstellungsexports", () => {
  for (const [name, { table, mit, ohne }] of Object.entries(FELDER)) {
    it(`ordnet jede Spalte von ${getTableName(table)} genau einmal zu`, () => {
      const spalten = Object.keys(getTableColumns(table)).sort();
      const ausgelassen = Object.keys(ohne);
      expect([...mit, ...ausgelassen].sort(), `${name}: neue Spalte in felder.ts unter mit oder ohne eintragen`).toEqual(spalten);
      expect(mit.filter((spalte) => ausgelassen.includes(spalte))).toEqual([]);
    });
  }

  it("nimmt keine verschlüsselte Spalte mit", () => {
    const geheim = Object.values(FELDER).flatMap(({ table, mit }) => {
      const spalten: Record<string, { name: string }> = getTableColumns(table);
      return mit.filter((key) => spalten[key]?.name.includes("ciphertext")).map((key) => `${getTableName(table)}.${key}`);
    });
    expect(geheim).toEqual([]);
  });

  it("begründet jede ausgelassene Spalte", () => {
    for (const { ohne } of Object.values(FELDER)) for (const grund of Object.values(ohne)) expect(grund?.trim()).toBeTruthy();
  });

  it("hält die Felder der Formatversion fest", () => {
    // Ändert sich die Liste, schlägt das hier fehl: Formatversion in format.ts prüfen und, ob der Import Dateien der
    // bisherigen Version weiter liest; danach den neuen Wert eintragen
    const felder = Object.fromEntries(Object.entries(FELDER).map(([name, { mit }]) => [name, [...mit].sort()]));
    const sha256 = createHash("sha256").update(JSON.stringify(felder)).digest("hex");
    expect({ version: SETTINGS_EXPORT_VERSION, sha256 }).toEqual({ version: 1, sha256: "85524f638a0248cfe4b53e33be9d9098a756089a095dfe1ece387756da6283cd" });
  });
});
