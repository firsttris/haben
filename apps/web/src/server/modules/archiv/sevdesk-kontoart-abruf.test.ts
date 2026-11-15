import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import antworten from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/accounting-type.json";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #472: Der Abruf holt nach den Belegen zu jeder archivierten Gutschrift mit `bookingCategory` ACCOUNTING_TYPE den Kontostamm
 * (GET /AccountingType/{id}), auch für Gutschriften aus einem früheren Lauf, und legt die Antwort unverändert ab. Ein gleicher
 * Stand kommt nicht doppelt; die Archivkopie der Gutschrift bleibt unverändert.
 */

const [dienstleister, erloese] = antworten as unknown as [Record<string, unknown>, Record<string, unknown>];
const TOKEN = "0123456789abcdef0123456789abcdef";

describe.skipIf(!testDatabaseUrl)("sevDesk-Abruf der Buchungskonten (Postgres)", () => {
  let sql: postgres.Sql;
  let sevdesk: typeof import("./sevdesk.ts");
  let importPkg: typeof import("@haben/import");
  const calls: { method: string; path: string }[] = [];
  const answers = new Map<string, () => Response | Promise<Response>>();

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const accountingTypeCalls = () =>
    calls
      .filter((c) => c.path.startsWith("/AccountingType/"))
      .map((c) => c.path)
      .sort();
  const stored = async () =>
    (await sql`select accounting_type_id as id, raw from sevdesk_accounting_types order by accounting_type_id, created_at`) as unknown as {
      id: string;
      raw: Record<string, unknown>;
    }[];

  /** Gutschrift aus einem früheren Lauf, wie der Abruf sie gespeichert hat */
  async function earlier(lexofficeId: string, raw: Record<string, unknown>) {
    const [run] = await sql`select id from lexoffice_imports order by started_at limit 1`;
    await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${lexofficeId}, 'sevdesk', ${run!.id}, 'creditnote', 'einnahme', ${lexofficeId}, '2024-01-15', 'open', -100, -19, -119,
      '[{"rate":1900,"net":-100,"tax":-19}]', '[]', '{"status":"open","openAmount":-119,"paidDate":null,"items":[]}', ${JSON.stringify(raw)}::jsonb)`;
  }

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    importPkg = await import("@haben/import");
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'soll', 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (source, status, progress) values ('sevdesk', 'fertig', '{}')`;
    const ref = (id: string) => ({ id, objectName: "AccountingType" });
    await earlier("creditnote/40", { id: "40", bookingCategory: "ACCOUNTING_TYPE", accountingType: ref("ID_66") });
    await earlier("creditnote/41", { id: "41", bookingCategory: "ACCOUNTING_TYPE", accountingType: ref("ID_66") });
    await earlier("creditnote/42", { id: "42", bookingCategory: "PROVISION", accountingType: ref("32891") });
    await earlier("creditnote/44", { id: "44", bookingCategory: "accounting_type", accountingType: ref("ID_99") });
    await earlier("creditnote/45", { id: "45", bookingCategory: "ACCOUNTING_TYPE" });
    await earlier("voucher/46", { id: "46", bookingCategory: "ACCOUNTING_TYPE", accountingType: ref("ID_77") });

    sevdesk.setSevdeskClientFactory(
      (o) =>
        new importPkg.SevdeskClient({
          ...o,
          minIntervalMs: 0,
          maxRetries: 0,
          sleep: async () => {},
          fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(String(input));
            const path = url.pathname.replace(/^\/api\/v1/, "");
            calls.push({ method: init?.method ?? "GET", path });
            const list = (objects: unknown[]) => json({ objects: url.searchParams.get("offset") === "0" ? objects : [] });
            const answer = answers.get(path);
            if (answer) return answer();
            switch (path) {
              case "/Tools/bookkeepingSystemVersion":
                return json({ objects: { version: "1.0" } });
              case "/CreditNote":
                return list([
                  {
                    id: "43",
                    creditNoteNumber: "GS-43",
                    creditNoteDate: "2024-02-01T00:00:00+01:00",
                    status: "200",
                    bookingCategory: "ACCOUNTING_TYPE",
                    accountingType: { id: "ID_63", objectName: "AccountingType" },
                    sumNet: "1.00",
                    sumTax: "0.19",
                    sumGross: "1.19",
                  },
                ]);
              case "/CreditNotePos":
                return list([{ id: "1", taxRate: "19", sumNet: "1.00", sumTax: "0.19", sumGross: "1.19" }]);
              case "/Contact":
              case "/ContactAddress":
              case "/CommunicationWay":
              case "/Invoice":
              case "/Voucher":
              case "/Order":
              case "/CheckAccount":
              case "/CheckAccountTransactionLog":
                return list([]);
            }
            return json({ error: { message: `unbekannt ${path}` } }, 404);
          }) as typeof fetch,
        }),
    );
    await sevdesk.saveSevdeskKey("test-user", TOKEN);
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(() => {
    calls.length = 0;
    answers.clear();
    answers.set("/AccountingType/ID_66", () => json({ objects: [dienstleister] }));
    answers.set("/AccountingType/ID_63", () => json({ objects: [erloese] }));
  });

  it("ruft jede ID einmal ab, auch für Gutschriften aus einem früheren Lauf, und legt die Antwort unverändert ab", async () => {
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    const latest = (await sevdesk.latestSevdeskImport())!;
    expect(latest.status).toBe("fertig");
    expect(accountingTypeCalls()).toEqual(["/AccountingType/ID_63", "/AccountingType/ID_66", "/AccountingType/ID_99"]);
    expect(await stored()).toEqual([
      { id: "ID_63", raw: erloese },
      { id: "ID_66", raw: dienstleister },
    ]);
    // ID_99 kennt sevDesk nicht (404): ein Fehler dieser ID, kein Abbruch
    expect(latest.progress.failed).toEqual([
      { lexofficeId: "accountingtype/ID_99", number: "Buchungskonto ID_99", message: expect.stringMatching(/^Buchungskonto nicht abgerufen: Nicht gefunden/) },
    ]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("legt beim zweiten Lauf keinen gleichen Stand doppelt an, einen geänderten schon", async () => {
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect(await stored()).toHaveLength(2);
    expect(accountingTypeCalls()).toHaveLength(3);
    answers.set("/AccountingType/ID_66", () => json({ objects: [{ ...dienstleister, name: "Dienstleister (umbenannt)" }] }));
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect((await stored()).map((r) => r.id)).toEqual(["ID_63", "ID_66", "ID_66"]);
  });

  it("ändert die archivierten Gutschriften nicht", async () => {
    const [row] = await sql`select raw from lexoffice_vouchers where lexoffice_id = 'creditnote/40'`;
    expect(row!.raw).toEqual({ id: "40", bookingCategory: "ACCOUNTING_TYPE", accountingType: { id: "ID_66", objectName: "AccountingType" } });
  });

  it.each([
    [401, "API-Token ungültig oder abgelaufen"],
    [403, "Kein Zugriff – der API-Token hat keine Berechtigung"],
  ])("bricht bei %s den Lauf ab", async (status, error) => {
    answers.set("/AccountingType/ID_63", () => json({}, status));
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect(await sevdesk.latestSevdeskImport()).toMatchObject({ status: "fehler", error });
  });

  it("bricht beim Abbrechen den Lauf ab", async () => {
    answers.set("/AccountingType/ID_63", async () => {
      const latest = (await sevdesk.latestSevdeskImport())!;
      sevdesk.cancelSevdeskImport(latest.id);
      return json({ objects: [erloese] });
    });
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect(await sevdesk.latestSevdeskImport()).toMatchObject({ status: "abgebrochen" });
    expect(accountingTypeCalls()).toEqual(["/AccountingType/ID_63"]);
  });

  it("hält die Antworten unveränderlich und schreibt sie ins Änderungsprotokoll", async () => {
    await expect(sql`update sevdesk_accounting_types set raw = '{}'::jsonb`).rejects.toThrow();
    await expect(sql`delete from sevdesk_accounting_types`).rejects.toThrow();
    await expect(sql`truncate sevdesk_accounting_types`).rejects.toThrow(/TRUNCATE/);
    const audit = await sql`select actor, action from audit_log where table_name = 'sevdesk_accounting_types' order by id limit 1`;
    expect(audit).toEqual([{ actor: "test-user", action: "INSERT" }]);
  });
});
