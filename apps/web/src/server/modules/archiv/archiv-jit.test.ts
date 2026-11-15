import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Abgleich je Jahr und offene Posten lesen alle Archivbelege mit vielen korrelierten Unterabfragen. Die geschätzten Kosten
 * wachsen mit dem Quadrat der Belege: Schon bei einigen hundert liegen sie über jit_above_cost (100.000), ab etwa 500 auch
 * über jit_optimize_above_cost. PostgreSQL kompiliert dann Hunderte Funktionen, das dauert Sekunden, die Abfrage selbst
 * Millisekunden. Statt einer Zeitgrenze prüft der Test die Pläne: auto_explain meldet jeden Plan als NOTICE an die
 * Verbindungen der App, und postgres.js gibt sie ohne eigenen Handler mit console.log aus.
 */

type Plan = { "Query Text": string; Plan: { "Total Cost": number }; JIT?: { Functions: number } };

describe.skipIf(!testDatabaseUrl)("Archiv ohne JIT (Postgres)", () => {
  let sql: postgres.Sql;
  let lexoffice: typeof import("./lexoffice.ts");
  let open: typeof import("./legacy-open.ts");
  let archivExport: typeof import("./export.ts");
  let sevdeskPayments: typeof import("./sevdesk-payments.ts");
  const plans: Plan[] = [];

  beforeAll(async () => {
    sql = await setupTestDb();
    // Gilt für jede neue Verbindung zu dieser Testdatenbank, also auch für den Pool der App, der erst beim Import entsteht
    const database = sql(new URL(testDatabaseUrl!).pathname.slice(1));
    await sql`alter database ${database} set session_preload_libraries = 'auto_explain'`;
    await sql`alter database ${database} set auto_explain.log_min_duration = 0`;
    await sql`alter database ${database} set auto_explain.log_format = 'json'`;
    await sql`alter database ${database} set auto_explain.log_level = 'notice'`;
    await sql`alter database ${database} set jit = on`;

    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'ist', 'einzelunternehmen')`;
    const [{ id: importId }] =
      (await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', '{}'::jsonb, 'sevdesk') returning id`) as unknown as [
        { id: string },
      ];
    // 600 sevDesk-Belege über drei Jahre: Rechnungen, Belege und Gutschriften, offen und bezahlt. Zahlungsverlauf „storno“, damit
    // die Sperre für unvollständige sevDesk-Zahlungen die Zeitraumabfrage mit Zahlungen nicht vor der Hauptabfrage abbricht
    await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      select case i % 3 when 0 then 'invoice/' when 1 then 'voucher/' else 'creditnote/' end || i, 'sevdesk', ${importId},
        case i % 3 when 0 then 'invoice' when 1 then 'purchaseinvoice' else 'creditnote' end,
        case i % 3 when 1 then 'ausgabe' else 'einnahme' end,
        'B-' || i, date '2023-01-01' + (i % 1000), case when i % 5 = 0 then 'open' else 'paid' end, 10000, 1900,
        case i % 3 when 2 then -11900 else 11900 end, '[{"rate":1900,"net":10000,"tax":1900}]'::jsonb, '[]'::jsonb,
        jsonb_build_object('status', case when i % 5 = 0 then 'open' else 'paid' end, 'openAmount', case when i % 5 = 0 then 119 else 0 end, 'items', '[]'::jsonb, 'history', 'storno'),
        jsonb_build_object('creditDebit', case when i % 2 = 0 then 'C' else 'D' end, 'taxRule', jsonb_build_object('id', '1'),
          'positions', jsonb_build_array(jsonb_build_object('accountingType', jsonb_build_object('id', 'K' || (i % 20))),
            jsonb_build_object('accountingType', jsonb_build_object('id', 'K' || (i % 7)))))
      from generate_series(1, 600) i`;
    // Kontostamm der Konten aus den Positionen (#472)
    await sql`insert into sevdesk_accounting_types (import_id, accounting_type_id, raw)
      select ${importId}, 'K' || k, jsonb_build_object('id', 'K' || k, 'skr03', (4900 + k)::text, 'skr04', (6300 + k)::text) from generate_series(0, 19) k`;
    await sql`analyze lexoffice_vouchers`;

    vi.spyOn(console, "log").mockImplementation((notice: { message?: string }) => {
      const message = notice?.message ?? "";
      const json = message.indexOf("{");
      if (message.startsWith("duration:") && json >= 0) plans.push(JSON.parse(message.slice(json)) as Plan);
    });
    lexoffice = await import("./lexoffice.ts");
    open = await import("./legacy-open.ts");
    archivExport = await import("./export.ts");
    sevdeskPayments = await import("./sevdesk-payments.ts");
  }, 30_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await sql?.end();
  });

  /** Pläne der Abfragen über alle Archivbelege, die `run` auslöst */
  async function heavyPlans(run: () => Promise<unknown>) {
    plans.length = 0;
    await run();
    return plans.filter((p) => p["Query Text"].includes("lexoffice_vouchers") && p.Plan["Total Cost"] > 100_000);
  }

  it("Abgleich je Jahr: die teure Abfrage läuft ohne JIT", async () => {
    const heavy = await heavyPlans(() => lexoffice.reconciliation());
    expect(heavy.length).toBeGreaterThan(0);
    expect(heavy.filter((p) => p.JIT).map((p) => p.JIT)).toEqual([]);
  });

  it("Offene Posten: die teure Abfrage läuft ohne JIT", async () => {
    const heavy = await heavyPlans(() => open.openLegacyItems("2025-12-31"));
    expect(heavy.length).toBeGreaterThan(0);
    expect(heavy.filter((p) => p.JIT).map((p) => p.JIT)).toEqual([]);
  });

  it("Umsatzsteuer je Zeitraum mit Zahlungen: die teuren Abfragen laufen ohne JIT", async () => {
    const heavy = await heavyPlans(() => lexoffice.legacyVouchersForPeriod({ period: "2024", direction: "alle", search: "", withPayments: true, limit: 50 }));
    expect(heavy.length).toBeGreaterThan(1);
    expect(heavy.filter((p) => p.JIT).map((p) => p.JIT)).toEqual([]);
  }, 30_000);

  it("Jahresexport: die Archivbelege des Jahres laufen ohne JIT", async () => {
    const heavy = await heavyPlans(async () => {
      for await (const _ of archivExport.exportYear(2024)) {
        // nur durchlaufen
      }
    });
    expect(heavy.length).toBeGreaterThan(0);
    expect(heavy.filter((p) => p.JIT).map((p) => p.JIT)).toEqual([]);
  }, 30_000);

  it("Einzelzahlungen aus sevDesk: die Abfrage über alle sevDesk-Belege läuft ohne JIT", async () => {
    const client = {
      async *checkAccountTransactionLogs() {},
      async *checkAccounts() {},
    } as unknown as Parameters<typeof sevdeskPayments.importSevdeskPayments>[2];
    const progress = { failed: [] } as unknown as Parameters<typeof sevdeskPayments.importSevdeskPayments>[3];
    const heavy = await heavyPlans(() => sevdeskPayments.importSevdeskPayments("test", "import", client, progress, new AbortController().signal));
    expect(heavy.length).toBeGreaterThan(0);
    expect(heavy.filter((p) => p.JIT).map((p) => p.JIT)).toEqual([]);
  }, 30_000);
});
