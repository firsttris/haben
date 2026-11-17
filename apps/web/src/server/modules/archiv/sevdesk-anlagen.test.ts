import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mitKontoart from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/asset-mit-kontoart.json";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { json, sevdeskFakeFetch } from "./test-sevdesk-api.ts";

/*
 * #472: Anlagenverzeichnis aus sevDesk als Vorschlag zum 01.01., übernommen wie „Anlage übernehmen“. Nichts wird
 * gebucht, bis die AfA gebucht wird; dann Eröffnung gegen den Saldenvortrag und AfA auf die Konten der Art. Ein
 * zweiter Abruf erkennt übernommene Anlagen an der Kennung aus sevDesk.
 */

const TOKEN = "0123456789abcdef0123456789abcdef";
const STICHTAG = "2026-01-01";
const actor = "test-user";

describe.skipIf(!testDatabaseUrl)("sevDesk: Anlagen übernehmen (Postgres)", () => {
  let sql: postgres.Sql;
  let sevdesk: typeof import("./sevdesk.ts");
  let anlagen: typeof import("./sevdesk-anlagen.ts");
  let assets: typeof import("../buchhaltung/assets.ts");
  let importPkg: typeof import("@haben/import");
  const calls: string[] = [];
  let served: unknown[] = mitKontoart.objects;

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    anlagen = await import("./sevdesk-anlagen.ts");
    assets = await import("../buchhaltung/assets.ts");
    importPkg = await import("@haben/import");
    sevdesk.setSevdeskClientFactory(
      (o) =>
        new importPkg.SevdeskClient({
          ...o,
          minIntervalMs: 0,
          maxRetries: 0,
          sleep: async () => {},
          fetch: sevdeskFakeFetch(({ path, url, method }) => {
            calls.push(`${method} ${path}?embed=${url.searchParams.get("embed") ?? ""}`);
            if (path === "/Asset") return json({ objects: url.searchParams.get("offset") === "0" ? served : [] });
          }),
        }),
    );
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function company(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", rechtsform: "einzelunternehmen" | "gmbh") {
    await leeren(sql)`truncate asset_depreciations, assets, journal_lines, journal_entries, year_closings, company, sevdesk_connection cascade`;
    await sql`insert into company (id, name, versteuerung, kontenrahmen, bundesland, rechtsform)
      values (1, 'Testfirma', ${versteuerung}, ${kontenrahmen}, 'BY', ${rechtsform})`;
    await sevdesk.saveSevdeskKey(actor, TOKEN);
    calls.length = 0;
    served = mitKontoart.objects;
  }

  beforeEach(() => company("SKR03", "ist", "einzelunternehmen"));

  const pick = (sevId: string, kind: string | null = null) => ({ sevId, kind: kind as never });

  for (const [kontenrahmen, versteuerung, rechtsform, pkwKonto, afaKonto, bgaKonto] of [
    ["SKR03", "ist", "einzelunternehmen", "0320", "4832", "0490"],
    ["SKR04", "soll", "einzelunternehmen", "0520", "6222", "0690"],
    ["SKR03", "soll", "gmbh", "0320", "4832", "0490"],
    ["SKR04", "ist", "gmbh", "0520", "6222", "0690"],
  ] as const) {
    it(`${kontenrahmen}, ${versteuerung}, ${rechtsform}: Vorschlag, Übernahme ohne Buchung, Eröffnung und AfA erst mit der AfA-Buchung`, async () => {
      await company(kontenrahmen, versteuerung, rechtsform);
      const preview = await anlagen.previewSevdeskAssets(STICHTAG);
      expect(preview.problem).toBeNull();
      expect(preview.rows.map((r) => [r.sevId, r.status, r.kind, r.account])).toEqual([
        ["ID_1", "neu", "kfz", pkwKonto],
        ["ID_4", "erledigt", null, null],
        ["ID_6", "neu", "sonstiges", bgaKonto],
        ["ID_9", "neu", "transport", kontenrahmen === "SKR03" ? "0380" : "0560"],
        ["ID_12", "neu", null, null],
      ]);
      // Nur GET; nichts in sevDesk geändert
      expect(calls.every((c) => c.startsWith("GET "))).toBe(true);
      expect(calls).toContain("GET /Asset?embed=accountingType");

      // Ohne gewählte Art keine Übernahme, und dann gar keine
      await expect(anlagen.takeOverSevdeskAssets(actor, STICHTAG, [pick("ID_1"), pick("ID_12")])).rejects.toThrow("Art wählen");
      expect(await sql`select id from assets`).toHaveLength(0);

      expect(await anlagen.takeOverSevdeskAssets(actor, STICHTAG, [pick("ID_1"), pick("ID_12", "edv")])).toEqual({ created: 2 });
      const rows = await sql`select name, kind, method, account, useful_life_months as "life", opening_date::text as "opening",
        opening_book_value as "value", note from assets order by note`;
      expect(rows.map((r) => ({ ...r }))).toEqual([
        {
          name: "<anon>",
          kind: "kfz",
          method: "linear",
          account: pkwKonto,
          life: 84,
          opening: STICHTAG,
          value: 914_286,
          note: "Aus sevDesk: Anlage Nr. 1001, ID ID_1",
        },
        {
          name: "<anon>",
          kind: "edv",
          method: "linear",
          account: kontenrahmen === "SKR03" ? "0420" : "0650",
          life: 36,
          opening: STICHTAG,
          value: 3_333,
          note: "Aus sevDesk: Anlage Nr. 1005, ID ID_12",
        },
      ]);
      expect(await sql`select id from journal_entries`).toHaveLength(0);

      // Zweiter Abruf: übernommene als vorhanden, auch wenn die Bezeichnung geändert ist
      await sql`update assets set name = 'Motorrad' where note like '%ID ID_1'`;
      const again = await anlagen.previewSevdeskAssets(STICHTAG);
      expect(again.rows.find((r) => r.sevId === "ID_1")).toMatchObject({ status: "vorhanden" });
      await expect(anlagen.takeOverSevdeskAssets(actor, STICHTAG, [pick("ID_1")])).rejects.toThrow("Gibt es schon");

      await assets.bookDepreciation(actor, 2026, "2026-12-01");
      const [pkw] = await sql`select id from assets where name = 'Motorrad'`;
      const lines = await sql`select e.date::text as date, l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
        where e.source_id = ${pkw!.id} order by e.date, l.debit desc`;
      // 914.286 Cent über die restlichen 64 Monate, 12 davon in 2026
      const afa = Math.round((914_286 * 12) / 64);
      expect(lines.map((r) => ({ ...r }))).toEqual([
        { date: STICHTAG, account: pkwKonto, debit: 914_286, credit: 0 },
        { date: STICHTAG, account: "9000", debit: 0, credit: 914_286 },
        { date: "2026-12-31", account: afaKonto, debit: afa, credit: 0 },
        { date: "2026-12-31", account: pkwKonto, debit: 0, credit: afa },
      ]);

      // Nach gebuchter AfA 2026 kein Stichtag mehr in 2026
      expect((await anlagen.previewSevdeskAssets(STICHTAG)).problem).toBe(
        "Für 2026 ist die AfA schon gebucht; der Übernahmestichtag muss danach liegen, frühestens am 01.01.2027.",
      );
      await expect(anlagen.takeOverSevdeskAssets(actor, STICHTAG, [pick("ID_6")])).rejects.toThrow("AfA schon gebucht");
    });
  }

  it("Stichtag nur am 01.01., Erledigtes nicht übernehmbar, ohne Token kein Abruf", async () => {
    await expect(anlagen.previewSevdeskAssets("2026-03-01")).rejects.toThrow("zum 01.01.");
    await expect(anlagen.takeOverSevdeskAssets(actor, STICHTAG, [pick("ID_4", "sonstiges")])).rejects.toThrow("im Anschaffungsjahr voll abgeschrieben");
    await expect(anlagen.takeOverSevdeskAssets(actor, STICHTAG, [pick("ID_99", "sonstiges")])).rejects.toThrow("gibt es in sevDesk nicht mehr");
    await sevdesk.removeSevdeskKey(actor);
    await expect(anlagen.previewSevdeskAssets(STICHTAG)).rejects.toThrow("API-Token");
  });

  it("zwei gleiche Anlagen aus sevDesk (gleiche Bezeichnung, Anschaffung, Kosten) sind zwei Anlagen, keine Dublette", async () => {
    // Etwa zwei gleiche Monitore aus einer Rechnung: in sevDesk zwei Anlagen mit eigener Nummer und Kennung
    const pkw = mitKontoart.objects[0]!;
    served = [pkw, { ...pkw, id: "ID_2", assetNumber: "1006" }];
    const preview = await anlagen.previewSevdeskAssets(STICHTAG);
    expect(preview.rows.map((r) => [r.sevId, r.status])).toEqual([
      ["ID_1", "neu"],
      ["ID_2", "neu"],
    ]);
    expect(await anlagen.takeOverSevdeskAssets(actor, STICHTAG, [pick("ID_1")])).toEqual({ created: 1 });
    // Die erste übernommene Anlage macht die zweite nicht zur Dublette
    const again = await anlagen.previewSevdeskAssets(STICHTAG);
    expect(again.rows.map((r) => [r.sevId, r.status])).toEqual([
      ["ID_1", "vorhanden"],
      ["ID_2", "neu"],
    ]);
    expect(await anlagen.takeOverSevdeskAssets(actor, STICHTAG, [pick("ID_2")])).toEqual({ created: 1 });
  });

  it("eine von Hand übernommene gleiche Anlage bleibt eine Dublette", async () => {
    const pkw = mitKontoart.objects[0]!;
    served = [pkw];
    await sql`insert into assets (name, kind, method, account, acquisition_date, cost, useful_life_months, opening_date, opening_book_value)
      values ('<anon>', 'kfz', 'linear', '0320', '2024-05-16', 1200000, 84, ${STICHTAG}, 914286)`;
    const preview = await anlagen.previewSevdeskAssets(STICHTAG);
    expect(preview.rows.map((r) => [r.sevId, r.status])).toEqual([["ID_1", "vorhanden"]]);
  });
});
