import { ACCOUNTS, bareinnahmePosting, type Kontenrahmen, type PostingLine } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { turnoverFixtures } from "../../../test-fixtures/gesamtumsatz.ts";

describe.skipIf(!testDatabaseUrl)("Gesamtumsatz: ausdrücklich zugeordnete manuelle KU-Kassenbuchung (Postgres)", () => {
  let sql: postgres.Sql;
  let read: typeof import("./gesamtumsatz.ts");
  let f: Awaited<ReturnType<typeof turnoverFixtures>>;
  beforeAll(async () => {
    sql = await setupTestDb();
    read = await import("./gesamtumsatz.ts");
  }, 30_000);
  beforeEach(async () => {
    f = await turnoverFixtures(sql);
  });
  afterAll(async () => {
    await sql?.end();
  });

  const cashLines = (amount: number, chart: Kontenrahmen = "SKR03") => bareinnahmePosting({ behandlung: "kleinunternehmer", steuersatz: 0 }, amount, chart);

  // § 19 Abs. 2 UStG: https://www.gesetze-im-internet.de/ustg_1980/__19.html — vereinnahmte Entgelte auch bei Soll.
  // Der bestätigte enge Herkunftsnachweis steht in
  // https://github.com/Speicherstadt/haben/pull/926#issuecomment-6904783330; Kontonummer oder heutiger KU-Status genügen nicht.
  it.each([
    ["ist", "SKR03"],
    ["soll", "SKR04"],
  ] as const)("zählt belegte manuelle KU-Bareinnahme bei %s/%s am Kassentag", async (mode, chart) => {
    f = await turnoverFixtures(sql, mode, chart);
    const entry = await f.journal("manuell", crypto.randomUUID(), cashLines(12_345, chart), "2026-10-15");
    const result = await read.gesamtumsatzForYear(2026);
    expect(result).toMatchObject({ included: 12_345, complete: true });
    expect(result.items).toEqual([
      expect.objectContaining({
        source: "journal",
        sourceId: entry,
        occurredOn: "2026-10-15",
        gross: 12_345,
        net: 12_345,
        basisSource: "derived",
        classification: { kind: "domestic" },
        decision: "included",
      }),
    ]);
  });

  it("erhält Vorjahresumsatz über der Grenze und die negative Korrektur im tatsächlichen Folgejahr", async () => {
    await f.journal("manuell", crypto.randomUUID(), cashLines(2_500_001), "2025-12-31");
    await f.journal("manuell", crypto.randomUUID(), cashLines(-1_001), "2026-01-02");
    expect(await read.gesamtumsatzForYear(2025)).toMatchObject({ included: 2_500_001, complete: true });
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: -1_001, complete: true });
  });

  it("verrechnet eine verknüpfte echte SKR04-Gegenbuchung ohne positiven Doppelzufluss", async () => {
    f = await turnoverFixtures(sql, "soll", "SKR04");
    const lines = cashLines(8_765, "SKR04");
    const original = await f.journal("manuell", crypto.randomUUID(), lines);
    const { withActor } = await import("../../db/actor.ts");
    const { openBooks, post, reverseLinesIn } = await import("../buchhaltung/index.ts");
    const reversal = await withActor("umsatztest", async (tx) =>
      post(tx, await openBooks(tx), {
        date: "2026-11-06",
        description: "Storno der fiktiven Bareinnahme",
        sourceType: "manuell",
        sourceId: crypto.randomUUID(),
        reversesId: original,
        lines: reverseLinesIn("SKR04", "SKR04", lines),
      }),
    );
    const result = await read.gesamtumsatzForYear(2026);
    expect(result).toMatchObject({ included: 0, complete: true });
    expect(result.items).toEqual([
      expect.objectContaining({ sourceId: original, net: 8_765, decision: "included" }),
      expect.objectContaining({ sourceId: reversal, net: -8_765, decision: "included" }),
    ]);
  });

  it("überträgt die bestätigte manuelle Herkunft nicht auf einen KU-Kassenimport", async () => {
    const manual = await f.journal("manuell", crypto.randomUUID(), cashLines(500));
    const imported = await f.journal("import", crypto.randomUUID(), cashLines(700));
    const result = await read.gesamtumsatzForYear(2026);
    expect(result).toMatchObject({ included: 500, complete: false });
    expect(result.items).toContainEqual(expect.objectContaining({ sourceId: manual, decision: "included" }));
    expect(result.items).toContainEqual(expect.objectContaining({ sourceId: imported, net: null, decision: "unknown" }));
  });

  it.each([null, "Steuerfrei", "Drittland"] as const)("hält das KU-Konto mit Schlüssel %s ungeklärt", async (taxCode) => {
    await f.journal(
      "manuell",
      crypto.randomUUID(),
      cashLines(1_000).map((line, i) => (i === 1 ? { ...line, taxCode } : line)),
    );
    const result = await read.gesamtumsatzForYear(2026);
    expect(result).toMatchObject({ included: 0, complete: false });
    expect(result.items[0]).toMatchObject({ net: null, classification: null, decision: "unknown" });
  });

  it("verlangt den KU-Schlüssel an sämtlichen Erlösgegenzeilen statt nur an der Kasse", async () => {
    const a = ACCOUNTS.SKR03;
    const lines: PostingLine[] = [
      { account: a.kasse, debit: 1_000, credit: 0, taxCode: "KU" },
      { account: a.erloeseSonder.kleinunternehmer, debit: 0, credit: 600, taxCode: "KU" },
      { account: a.erloese[0], debit: 0, credit: 400, taxCode: null },
    ];
    await f.journal("manuell", crypto.randomUUID(), lines);
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 0, complete: false });
  });

  it.each(["bank", "geldtransit"] as const)("bestätigt aus einer freien KU-Buchung gegen %s keinen Kassenzufluss", async (account) => {
    await f.journal(
      "manuell",
      crypto.randomUUID(),
      cashLines(1_000).map((line, i) => (i === 0 ? { ...line, account: ACCOUNTS.SKR03[account] } : line)),
    );
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 0, complete: false });
  });

  it("zählt die KU-Forderungsentstehung ohne Kasse weiterhin nicht als vereinnahmtes Entgelt", async () => {
    await f.journal(
      "manuell",
      crypto.randomUUID(),
      cashLines(1_000).map((line, i) => (i === 0 ? { ...line, account: ACCOUNTS.SKR03.forderungen } : line)),
    );
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 0, complete: true, items: [] });
  });

  it.each(["privateinlagen", "gesellschafter"] as const)("deutet eine Finanzierung über %s auch mit KU-Schlüssel nicht zu Erlösen um", async (account) => {
    await f.journal(
      "manuell",
      crypto.randomUUID(),
      cashLines(1_000).map((line, i) => (i === 1 ? { ...line, account: ACCOUNTS.SKR03[account] } : line)),
    );
    expect(await read.gesamtumsatzForYear(2026)).toMatchObject({ included: 0, complete: false });
  });
});
