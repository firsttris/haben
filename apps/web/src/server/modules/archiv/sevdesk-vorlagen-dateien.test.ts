import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import antworten from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/beleg-aus-vorlage.json";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #472: Belege aus einer Vorlage wiederkehrender Belege (RV) tragen in der API keine Datei, nur `origin` auf die Vorlage;
 * die Datei hängt an der Vorlage. Der Abruf hängt sie jedem solchen Beleg ohne eigene Datei an, auch Belegen aus einem
 * früheren Lauf, mit der Rolle „vorlage“, aber nur, wenn sevDesk den Beleg nach dem Hochladen der Datei angelegt hat: Eine
 * später angehängte Datei (etwa ein Zahlplan) gehört nicht zu früheren Monaten. Eine eigene Datei des Belegs bleibt allein.
 * Die Archivkopie bleibt unverändert, ein zweiter Lauf legt nichts doppelt an.
 */

const { vorlage, beleg } = antworten as unknown as { vorlage: Record<string, unknown>; beleg: Record<string, unknown> };
const TOKEN = "0123456789abcdef0123456789abcdef";
const PDF = "%PDF-1.4\n% Vorlage\n";
/** Die Datei der Vorlage kam am 15.03.2024 um 12 Uhr; Belege sind standardmäßig danach angelegt */
const HOCHGELADEN = "2024-03-15T12:00:00+01:00";
const ohneDatei = (id: string, origin: string, create = "2024-04-15T12:00:00+02:00") => ({
  ...beleg,
  id,
  create,
  description: `B-${id}`,
  origin: { id: origin, objectName: "Voucher" },
});

describe.skipIf(!testDatabaseUrl)("sevDesk: Datei der Vorlage an wiederkehrenden Belegen (Postgres)", () => {
  let sql: postgres.Sql;
  let sevdesk: typeof import("./sevdesk.ts");
  let archiv: typeof import("./lexoffice.ts");
  let importPkg: typeof import("@haben/import");
  const calls: { method: string; path: string }[] = [];
  const answers = new Map<string, () => Response | Promise<Response>>();

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const download = (content: string, filename: string | null) =>
    json({ objects: { base64Encoded: true, content: Buffer.from(content).toString("base64"), filename, mimetype: "application/pdf" } });
  const templateCalls = () => calls.filter((c) => /^\/(Voucher\/|Document\/)/.test(c.path)).map((c) => c.path);
  const files = async () =>
    (await sql`select v.lexoffice_id as voucher, f.role, f.lexoffice_file_id as "fileId", f.filename, f.mime_type as "mimeType"
      from lexoffice_voucher_files f join lexoffice_vouchers v on v.id = f.voucher_id order by 1, f.created_at`) as unknown as Record<string, string>[];

  /** Beleg aus einem früheren Lauf, wie der Abruf ihn gespeichert hat */
  async function earlier(raw: Record<string, unknown>) {
    const [run] = await sql`select id from lexoffice_imports order by started_at limit 1`;
    await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${`voucher/${String(raw.id)}`}, 'sevdesk', ${run!.id}, 'purchaseinvoice', 'ausgabe', ${String(raw.description)}, '2024-01-15', 'paid', 100, 0, 100,
      '[{"rate":0,"net":100,"tax":0}]', '[]', '{"status":"paid","openAmount":0,"paidDate":"2024-01-15","items":[]}', ${JSON.stringify(raw)}::jsonb)`;
  }

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    archiv = await import("./lexoffice.ts");
    importPkg = await import("@haben/import");
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'ist', 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (source, status, progress) values ('sevdesk', 'fertig', '{}')`;
    // früherer Lauf: ein Beleg vor dem Hochladen der Datei, einer genau dann, einer aus einer Vorlage ohne Datei
    await earlier(ohneDatei("ID_10", "ID_1", "2024-03-15T11:59:59+01:00"));
    await earlier(ohneDatei("ID_11", "ID_1", "2024-03-15T12:00:00+01:00"));
    await earlier(ohneDatei("ID_20", "ID_2"));

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
              case "/Voucher":
                // die Vorlage selbst steht in der Liste, wird aber kein Beleg; dazu ein neuer Beleg aus ihr und einer mit eigener Datei
                return list([vorlage, ohneDatei("ID_12", "ID_1"), { ...ohneDatei("ID_13", "ID_1"), document: { id: "ID_99", objectName: "Document" } }]);
              case "/VoucherPos":
                return list([]);
              case "/Voucher/ID_1":
                return json({ objects: [vorlage] });
              case "/Voucher/ID_2":
                return json({ objects: [{ ...vorlage, id: "ID_2", document: null }] });
              case "/Document/ID_5":
                return json({ objects: [{ id: "ID_5", objectName: "Document", create: HOCHGELADEN, update: HOCHGELADEN }] });
              case "/Document/ID_5/download":
                return download(PDF, "vertrag.pdf");
              case "/Document/ID_99/download":
                return download("%PDF-1.4\n% eigene Datei\n", "eigen.pdf");
              case "/Contact":
              case "/ContactAddress":
              case "/CommunicationWay":
              case "/Invoice":
              case "/CreditNote":
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
  });

  it("hängt die Datei der Vorlage an Belege ohne eigene Datei, die nach dem Hochladen entstanden, auch aus einem früheren Lauf", async () => {
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    const latest = (await sevdesk.latestSevdeskImport())!;
    expect(latest.status).toBe("fertig");
    expect(latest.progress.failed).toEqual([]);
    const ausVorlage = { role: "vorlage", fileId: "ID_5", filename: "vertrag.pdf", mimeType: "application/pdf" };
    // ID_10 entstand vor dem Hochladen und bleibt ohne Datei
    expect(await files()).toEqual([
      { voucher: "voucher/ID_11", ...ausVorlage },
      { voucher: "voucher/ID_12", ...ausVorlage },
      { voucher: "voucher/ID_13", role: "anhang", fileId: "ID_99", filename: "eigen.pdf", mimeType: "application/pdf" },
    ]);
    // die Vorlage ist kein Beleg; jede Vorlage und ihre Datei nur einmal angefragt
    expect(await sql`select 1 from lexoffice_vouchers where lexoffice_id = 'voucher/ID_1'`).toHaveLength(0);
    expect(templateCalls().sort()).toEqual(["/Document/ID_5", "/Document/ID_5/download", "/Document/ID_99/download", "/Voucher/ID_1", "/Voucher/ID_2"]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("legt beim zweiten Lauf nichts doppelt an und fragt Belege mit Datei nicht mehr an", async () => {
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect(await files()).toHaveLength(3);
    // nur für Belege weiter ohne Datei wird die Vorlage erneut angefragt; die Datei selbst nicht mehr
    expect(templateCalls().sort()).toEqual(["/Document/ID_5", "/Voucher/ID_1", "/Voucher/ID_2"]);
  });

  it("ändert die Archivkopie nicht und zeigt die Datei mit ihrer Herkunft", async () => {
    const [row] = await sql`select id, raw from lexoffice_vouchers where lexoffice_id = 'voucher/ID_11'`;
    expect(row!.raw).toEqual(ohneDatei("ID_11", "ID_1", "2024-03-15T12:00:00+01:00"));
    const detail = (await archiv.legacyVoucherDetail(row!.id as string))!;
    expect(detail.files).toEqual([expect.objectContaining({ role: "vorlage", filename: "vertrag.pdf" })]);
  });

  it("meldet eine Vorlage, die sich nicht abrufen lässt, ohne den Lauf abzubrechen", async () => {
    await earlier(ohneDatei("ID_30", "ID_3"));
    answers.set("/Voucher/ID_3", () => json({ error: { message: "kaputt" } }, 500));
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    const latest = (await sevdesk.latestSevdeskImport())!;
    expect(latest.status).toBe("fertig");
    expect(latest.progress.failed).toEqual([
      { lexofficeId: "voucher/ID_3", number: "Vorlage ID_3", message: expect.stringMatching(/^Datei der Vorlage nicht abgerufen \(1 Belege ohne Datei\): /) },
    ]);
  });

  it("bricht bei ungültigem Token den Lauf ab", async () => {
    answers.set("/Voucher/ID_2", () => json({}, 401));
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect(await sevdesk.latestSevdeskImport()).toMatchObject({ status: "fehler", error: "API-Token ungültig oder abgelaufen" });
  });

  it("hängt die Vorlage nicht an, wenn der früher ohne Datei archivierte Beleg in sevDesk inzwischen eine eigene Datei hat", async () => {
    await earlier(ohneDatei("ID_14", "ID_1"));
    answers.set("/Voucher", () =>
      json({ objects: [vorlage, { ...ohneDatei("ID_14", "ID_1"), document: { id: "ID_98", objectName: "Document" } }] }),
    );
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect((await files()).filter((f) => f.voucher === "voucher/ID_14" && f.role === "vorlage")).toEqual([]);
  });

  it("hält die angehängten Dateien unveränderlich", async () => {
    await expect(sql`update lexoffice_voucher_files set role = 'anhang' where role = 'vorlage'`).rejects.toThrow();
    await expect(sql`delete from lexoffice_voucher_files where role = 'vorlage'`).rejects.toThrow();
  });
});
