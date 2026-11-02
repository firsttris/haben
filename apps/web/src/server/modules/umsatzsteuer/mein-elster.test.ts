import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Voranmeldung als XML für Mein ELSTER (Postgres)", () => {
  let vat: typeof import("./vat.ts");
  let meinElster: typeof import("./mein-elster.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const period = { year: 2026, month: 10 };
  const text = (bytes: Uint8Array) => new TextDecoder("iso-8859-15").decode(bytes);

  beforeAll(async () => {
    sql = await setupTestDb();
    vat = await import("./vat.ts");
    meinElster = await import("./mein-elster.ts");
  });

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate vat_return_submissions, vat_returns, company`;
    await sql`insert into company (id, name, strasse, plz, ort, steuernummer, bundesland)
      values (1, 'Testfirma Müller', 'Musterstraße 1', '93047', 'Regensburg', '198/113/10010', 'BY')`;
  });

  it("liefert die Nutzdaten des gespeicherten Entwurfs in ISO-8859-15, ohne Hersteller-ID und ohne ihn zu ändern", async () => {
    const draft = await vat.saveDraft(actor, period, { kz81: 290_040, kz86: 0, kz66: 17_355 });
    const [before] = await sql`select status, updated_at::text from vat_returns where id = ${draft.id}`;
    const { bytes, filename } = await meinElster.meinElsterUpload(draft.id);
    expect(filename).toBe("UStVA_2026-10.xml");
    const xml = text(bytes);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="ISO-8859-15" standalone="no"\?>\n<Anmeldungssteuern /);
    expect(xml).toContain("<Zeitraum>10</Zeitraum>");
    expect(xml).toContain("<Steuernummer>9198011310010</Steuernummer>");
    expect(xml).toContain("<Kz81>2900</Kz81>");
    expect(xml).toContain("<Kz66>173.55</Kz66>");
    // Bemessungsgrundlage in vollen Euro: 2.900 € zu 19 % = 551,00 €, minus 173,55 € Vorsteuer
    expect(xml).toContain("<Kz83>377.45</Kz83>");
    expect(xml).toContain("<Name>Testfirma Müller</Name>");
    expect(bytes).toContain(0xfc);
    const [after] = await sql`select status, updated_at::text from vat_returns where id = ${draft.id}`;
    expect(after).toEqual(before);
  });

  it("kennzeichnet eine berichtigte Anmeldung mit Kz 10 und im Dateinamen", async () => {
    const draft = await vat.saveDraft(actor, period, { kz81: 100_000, kz86: 0, kz66: 0 });
    await sql`update vat_returns set berichtigt = true where id = ${draft.id}`;
    const { bytes, filename } = await meinElster.meinElsterUpload(draft.id);
    expect(filename).toBe("UStVA_2026-10_berichtigt.xml");
    expect(text(bytes)).toContain("<Kz10>1</Kz10>");
  });

  it("meldet fehlende Firmendaten und unbekannte Anmeldungen verständlich", async () => {
    const draft = await vat.saveDraft(actor, period, { kz81: 100_000, kz86: 0, kz66: 0 });
    await sql`update company set steuernummer = ''`;
    await expect(meinElster.meinElsterUpload(draft.id)).rejects.toThrow(/Firmendaten unvollständig/);
    await expect(meinElster.meinElsterUpload("00000000-0000-4000-8000-000000000000")).rejects.toThrow("Anmeldung nicht gefunden.");
  });

  it("meldet eine ID, die keine UUID ist, als unbekannte Anmeldung statt mit einem Datenbankfehler", async () => {
    await expect(meinElster.meinElsterUpload("------------------------------------")).rejects.toThrow("Anmeldung nicht gefunden.");
  });
});
