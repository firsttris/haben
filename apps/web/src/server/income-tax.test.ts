import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("Angaben zur Einkommensteuer (Postgres)", () => {
  let incomeTax: typeof import("./income-tax.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    incomeTax = await import("./income-tax.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("prüft IdNr. und Geburtsdatum der Kinder", async () => {
    const kind = { vorname: "Lena", geburtsdatum: "2020-01-15", familienkasse: "Familienkasse BW" };
    await expect(incomeTax.saveEstAngaben(actor, 2025, { kinder: [{ ...kind, idnr: "12345678901" }] })).rejects.toThrow(/Identifikationsnummer/);
    await expect(incomeTax.saveEstAngaben(actor, 2025, { kinder: [{ ...kind, geburtsdatum: "2020-02-30" }] })).rejects.toThrow(/Gültiges Datum/);
    await incomeTax.saveEstAngaben(actor, 2025, { kinder: [{ ...kind, idnr: "" }, { ...kind, idnr: "86 095 742 719" }] });
    expect((await incomeTax.loadEstAngaben(2025)).kinder.map((k) => k.idnr)).toEqual(["", "86095742719"]);
    await expect(incomeTax.saveEstAngaben(actor, 2025, { kinder: [{ ...kind, familienkasse: "" }] })).rejects.toThrow(/Familienkasse/);
  });

  it("verwirft gespeicherte Angaben nicht, die ein verschärftes Schema ablehnt", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const data = { vorsorge: { a: { pkv: 500_000 } }, sonderausgaben: {}, haushaltsnah: {}, kinder: [{ vorname: "Lena", geburtsdatum: "2020-01-15", idnr: "12345678901" }] };
    await sql`insert into income_tax_inputs (year, data) values (2024, ${JSON.stringify(data)}::jsonb)`;
    expect(await incomeTax.loadEstAngaben(2024)).toMatchObject({ vorsorge: { a: { pkv: 500_000 } }, kinder: [{ idnr: "12345678901" }] });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/2024 passen nicht zum Schema/));
  });
});
