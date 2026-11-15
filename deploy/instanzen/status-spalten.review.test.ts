/**
 * Test mit echtem Docker an #548: „startet neu“ und „? (Image zu alt)“ sind länger als die feste Breite der Spalte
 * Version; die folgenden Spalten rückten dadurch nach rechts.
 */
import { afterEach, beforeEach, expect, it } from "vitest";
import { umgebung } from "./test-docker.ts";

let t: ReturnType<typeof umgebung>;
beforeEach(() => {
  t = umgebung();
});
afterEach(() => t.aufraeumen());

it("hält die Spalten von status untereinander, auch mit langen Werten", async () => {
  for (const n of ["firma1", "firma2", "firma3"]) await t.lauf("neu", n, `${n}.example.de`);
  t.docker.z.zuAlt.add("firma2");
  t.docker.z.schleife.add("firma3");
  const zeilen = (await t.lauf("status")).stdout.split("\n");
  expect(zeilen).toHaveLength(4);
  expect(zeilen[2]).toContain("? (Image zu alt)");
  expect(zeilen[3]).toContain("startet neu");
  // Die Spalte Erreichbar beginnt in jeder Zeile an derselben Stelle wie in der Kopfzeile
  const stelle = zeilen[0]?.indexOf("Erreichbar") ?? -1;
  expect(stelle).toBeGreaterThan(0);
  expect(zeilen.slice(1).map((z) => z.slice(stelle, stelle + 2))).toEqual(["ja", "ja", "ja"]);
  // Kein Leerraum am Zeilenende
  expect(zeilen.filter((z) => z !== z.trimEnd())).toEqual([]);
});
