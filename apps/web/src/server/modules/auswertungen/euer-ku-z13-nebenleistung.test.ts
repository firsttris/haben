import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { turnoverFixtures } from "../../../test-fixtures/gesamtumsatz.ts";

// Amtliche EÜR-Anleitung 2025, Zeile 18: erstattete steuerliche Nebenleistungen bei KU in Zeilen 12 UND 13.
// https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2025
// § 3 Abs. 4 Nr. 4 AO: Zinsen §§ 233–237 sind Nebenleistungen. Keine Einordnung freier Guthabenzinsen als Hilfsumsatz.
// https://www.gesetze-im-internet.de/ao_1977/__3.html
describe.skipIf(!testDatabaseUrl)("Belegte USt-Erstattungszinsen nachrichtlich in KU-Zeile 13 (Postgres)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("../bank/index.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let turnover: typeof import("./gesamtumsatz.ts");
  let ku: typeof import("../jahreserklaerung/euer-ku.ts");
  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/index.ts");
    annual = await import("../jahreserklaerung/annual.ts");
    turnover = await import("./gesamtumsatz.ts");
    ku = await import("../jahreserklaerung/euer-ku.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function fixture(chart: "SKR03" | "SKR04" = "SKR03", mode: "ist" | "soll" = "ist", kleinunternehmer = true) {
    const f = await turnoverFixtures(sql, mode, chart);
    await sql`update company set kleinunternehmer=${kleinunternehmer}, firmendaten_gespeichert_at=now(), journal_ab=2026`;
    await sql`update bank_accounts set purpose='geschaeft' where id=${f.accountId}`;
    return f;
  }
  async function figures(year: number) {
    const euer = await annual.euerYear(year);
    return {
      z12: euer.figures.kleinunternehmer ?? 0,
      z13: euer.figures.kleinunternehmerAbzuege ?? 0,
      z16: euer.figures.steuerfrei ?? 0,
      z18: euer.figures.erstatteteUst ?? 0,
      gewinn: euer.gewinn,
      gesamtumsatz: (await turnover.gesamtumsatzForYear(year)).included,
    };
  }
  const interest = async (transactionId: string) =>
    bank.allocate("ku-z13-test", { kind: "steuer", transactionId, amount: 1_200, steuer: { art: "ust", jahr: 2025, posten: "zinsen233a" } });

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("%s/%s: Zinsen nur nachrichtlich; USt selbst und private Zinsen bleiben getrennt", async (chart, mode) => {
    const f = await fixture(chart, mode);
    await bank.allocateSplit("ku-z13-test", {
      transactionId: await f.transaction(9_200),
      parts: [
        { kind: "steuer", amount: 5_000, steuer: { art: "ust", jahr: 2025, posten: "steuer" } },
        { kind: "steuer", amount: 1_200, steuer: { art: "ust", jahr: 2025, posten: "zinsen233a" } },
        { kind: "steuer", amount: 3_000, steuer: { art: "est", jahr: 2025, posten: "zinsen233a" } },
      ],
    });
    expect(await figures(2026)).toEqual({ z12: 1_200, z13: 1_200, z16: 0, z18: 5_000, gewinn: 6_200, gesamtumsatz: 0 });
  });

  it("eine Aufhebung im Folgejahr verändert das vorher gespeicherte Vorjahresergebnis nicht", async () => {
    const f = await fixture();
    await interest(await f.transaction(1_200, "2026-12-30"));
    const before = await figures(2026);
    const [allocation] = await sql`select id from allocations where reverses_id is null`;
    await bank.reverseAllocation("ku-z13-test", allocation!.id, "2027-01-05");
    const after = await figures(2026);
    const next = await figures(2027);
    expect({ before, after, next }).toEqual({
      before: { z12: 1_200, z13: 1_200, z16: 0, z18: 0, gewinn: 1_200, gesamtumsatz: 0 },
      after: { z12: 1_200, z13: 1_200, z16: 0, z18: 0, gewinn: 1_200, gesamtumsatz: 0 },
      next: { z12: -1_200, z13: -1_200, z16: 0, z18: 0, gewinn: -1_200, gesamtumsatz: 0 },
    });
  });

  it("negative Gegenzeile wirkt an ihrem eigenen Folgemonat statt am Banktag", async () => {
    const f = await fixture("SKR04", "soll");
    await interest(await f.transaction(1_200, "2026-11-05"));
    const [allocation] = await sql`select id from allocations where reverses_id is null`;
    await bank.reverseAllocation("ku-z13-test", allocation!.id, "2026-12-06");
    const result = await turnover.gesamtumsatzForYear(2026);
    expect(result.included).toBe(0);
    expect(
      result.items
        .filter((item) => item.nonTaxableIncome)
        .map((item) => [item.occurredOn, item.net])
        .sort(),
    ).toEqual([
      ["2026-11-05", 1_200],
      ["2026-12-06", -1_200],
    ]);
    expect(await figures(2026)).toEqual({ z12: 0, z13: 0, z16: 0, z18: 0, gewinn: 0, gesamtumsatz: 0 });
  });

  it("Regelbesteuerte behalten Zeile 16 ohne nachrichtliche KU-Zeile", async () => {
    const f = await fixture("SKR04", "soll", false);
    await interest(await f.transaction(1_200));
    expect(await figures(2026)).toEqual({ z12: 0, z13: 0, z16: 1_200, z18: 0, gewinn: 1_200, gesamtumsatz: 0 });
  });

  it("ergänzt bei fehlender Richtung, privater Steuer oder freien Guthabenzinsen keinen Z13-Nachweis", async () => {
    const f = await fixture();
    const add = async (amount: number, extra: Record<string, unknown>) => {
      const transactionId = await f.transaction(amount);
      const [row] =
        await sql`insert into allocations ${sql({ transaction_id: transactionId, kind: "steuer", amount, tax_type: "ust", tax_year: 2025, tax_item: "zinsen233a", ...extra })} returning id`;
      return row!.id as string;
    };
    await f.transaction(1_200);
    const privateTax = await add(1_200, { tax_type: "est" });
    await add(-1_200, { reverses_id: privateTax, date: "2026-12-06" });
    await add(-1_200, {});
    await sql`insert into allocations (transaction_id, kind, amount) values (${await f.transaction(500)}, 'zinsertrag', 500)`;
    const result = await turnover.gesamtumsatzForYear(2026);
    expect(result.items.filter((item) => item.nonTaxableIncome)).toEqual([]);
    expect((await ku.kleinunternehmerAbzuege(2026)) ?? 0).toBe(0);
  });

  it("schätzt bei nicht in Euro belegtem Betrag keinen nachrichtlichen Wert", async () => {
    const f = await fixture();
    const [run] = await sql`select id from bank_imports where bank_account_id=${f.accountId}`;
    const [transaction] = await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, currency, dedup_hash)
      values (${f.accountId}, ${run!.id}, '2026-11-05', 1200, 'USD', ${crypto.randomUUID()}) returning id`;
    await sql`insert into allocations (transaction_id,kind,amount,tax_type,tax_year,tax_item) values (${transaction!.id},'steuer',1200,'ust',2025,'zinsen233a')`;
    expect((await turnover.gesamtumsatzForYear(2026)).items[0]).toMatchObject({ net: null, basisSource: "unknown" });
    expect((await ku.kleinunternehmerAbzuege(2026)) ?? 0).toBe(0);
  });
});
