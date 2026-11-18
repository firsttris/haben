import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FELDER } from "./felder.ts";

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
      const spalten = getTableColumns(table);
      return mit.filter((key) => spalten[key as keyof typeof spalten]?.name.includes("ciphertext")).map((key) => `${getTableName(table)}.${key}`);
    });
    expect(geheim).toEqual([]);
  });

  it("begründet jede ausgelassene Spalte", () => {
    for (const { ohne } of Object.values(FELDER)) for (const grund of Object.values(ohne)) expect(grund?.trim()).toBeTruthy();
  });
});
