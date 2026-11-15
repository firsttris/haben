import { parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("KU-Standardkonto mit versiegeltem Bestand (Postgres, #899)", () => {
  let sql: postgres.Sql;
  let cash: typeof import("../bank/index.ts");
  let ledger: typeof import("../buchhaltung/index.ts");
  let reports: typeof import("./index.ts");
  let withActor: typeof import("../../db/actor.ts").withActor;
  const actor = "ku-standardkonto-test";

  beforeAll(async () => {
    sql = await setupTestDb();
    cash = await import("../bank/index.ts");
    ledger = await import("../buchhaltung/index.ts");
    reports = await import("./index.ts");
    ({ withActor } = await import("../../db/actor.ts"));
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, allocations, cash_entries, journal_entries, company cascade`;
  });

  async function bestand(id: string) {
    const [entry] = await sql`select to_jsonb(e) as row from journal_entries e where id = ${id}`;
    const lines = await sql`select to_jsonb(l) as row from journal_lines l where entry_id = ${id} order by id`;
    const seals = await sql`select to_jsonb(s) as row from seals s where table_name = 'journal_entries' and row_id = ${id} order by id`;
    return { entry, lines, seals };
  }

  it.each([
    ["SKR03", "ist", "8195", "8192", "1200", "1000"],
    ["SKR04", "soll", "4185", "4184", "1800", "1600"],
  ] as const)("%s/%s: neue Erlöse und unveränderte Altbuchungen im selben DATEV-Jahr", async (kr, versteuerung, alt, neu, bank, kasse) => {
    await sql`insert into company (id,name,strasse,plz,ort,email,steuernummer,bundesland,kontenrahmen,versteuerung,kleinunternehmer,
      journal_ab,datev_berater_nr,datev_mandant_nr) values
      (1,'Musterbetrieb','Beispielstraße 1','93047','Regensburg','firma@example.com','198/113/10010','BY',
      ${kr},${versteuerung},true,2026,'29098','55003')`;

    // Bereits gebuchte Einnahme vor der Umstellung: regulär festgeschrieben und versiegelt, ohne Triggerbypass.
    const original = await withActor(actor, async (tx) =>
      ledger.post(tx, await ledger.openBooks(tx), {
        date: "2026-02-02",
        description: "Übernommene Kleinunternehmereinnahme",
        sourceType: "manuell",
        sourceId: crypto.randomUUID(),
        lines: [
          { account: bank, debit: 10_000, credit: 0, taxCode: null },
          { account: alt, debit: 0, credit: 10_000, taxCode: "KU" },
        ],
      }),
    );
    const before = await bestand(original);
    expect(before.seals).toHaveLength(1);
    expect(before.entry!.row.locked_at).not.toBeNull();

    const income = await cash.createCashIncome(
      actor,
      { date: "2026-06-02", amount: 20_000, text: "Neue Kleinunternehmereinnahme", steuer: { behandlung: "kleinunternehmer", steuersatz: 0 } },
      "2026-06-02",
    );
    const lines = await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_id = ${income.id} order by l.account`;
    expect(lines).toEqual([
      { account: kasse, debit: 20_000, credit: 0 },
      { account: neu, debit: 0, credit: 20_000 },
    ]);

    const exported = await reports.datevExport(2026, new Date("2026-12-31T12:00:00Z"));
    const stack = parseDatevBuchungsstapel(exported.bytes);
    expect(stack.header.kontenrahmen).toBe(kr);
    expect(stack.bookings.map((b) => [b.account, b.contraAccount, b.side, b.amount])).toEqual([
      [bank, alt, "S", 10_000],
      [kasse, neu, "S", 20_000],
    ]);
    expect(exported.bookings).toBe(2);
    expect((await reports.euerForYear(2026)).einnahmen.find((l) => l.key === "einnahmenKleinunternehmer")?.amount).toBe(30_000);
    expect(await bestand(original)).toEqual(before);
    expect(await sql`select art, tabelle, zeile, befund from haben_integrity_problems(1000)`).toEqual([]);
  });
});
