import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import antworten from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/dateistand.json";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { json, sevdeskFakeFetch } from "./test-sevdesk-api.ts";

/*
 * Randfälle zum Dateistand (#345), gefunden im Review von #1168:
 * 1. Scheitert das XML einer Rechnung einmal mit einem Fehler und sagt sevDesk beim nächsten Abruf ohne Fehler, es gebe
 *    keins (404, keine E-Rechnung), fehlt nichts mehr. Der Stand „Anhang fehlt“ darf dann nicht für immer bleiben und
 *    die Übernahme und den Abgleich sperren.
 * 2. Der Filter „Ohne Datei“ der Belegliste findet jeden betroffenen Beleg, auch in einem Jahr mit mehr als 1000 Belegen
 *    (die Liste zeigt höchstens 1000).
 * 3. Fehlen beim ersten Abruf PDF und XML einer Rechnung, darf das spätere Nachladen des PDFs den fehlenden XML nicht
 *    verdecken: Der Abruf fragt das XML wieder an und hält „Anhang fehlt“ fest, solange es scheitert.
 */

type Raw = Record<string, unknown>;
const fx = antworten as unknown as { rechnungMitDokument: { invoice: Raw } };
const TOKEN = "0123456789abcdef0123456789abcdef";
const pdf = (text: string) =>
  json({
    objects: { base64Encoded: true, content: Buffer.from(`%PDF-1.4\n% ${text}\n`).toString("base64"), filename: `${text}.pdf`, mimetype: "application/pdf" },
  });
const rechnung = { ...fx.rechnungMitDokument.invoice, id: "ID_401", invoiceNumber: "RE-2024-0401", invoiceDate: "2024-04-01T00:00:00+02:00" };
const eRechnung = { ...fx.rechnungMitDokument.invoice, id: "ID_402", invoiceNumber: "RE-2024-0402", invoiceDate: "2024-04-02T00:00:00+02:00" };

describe.skipIf(!testDatabaseUrl).each([
  ["SKR03", "ist"],
  ["SKR04", "soll"],
] as const)("Dateistand: Randfälle, %s und %s (Postgres)", (kontenrahmen, versteuerung) => {
  let sql: postgres.Sql;
  let sevdesk: typeof import("./sevdesk.ts");
  let archiv: typeof import("./lexoffice.ts");
  let offen: typeof import("./legacy-open.ts");
  /** Antwort auf getXml: erst ein Serverfehler, dann „keine E-Rechnung“ */
  let xmlStatus = 500;
  /** E-Rechnung ID_402: erst ab dem dritten Test gelistet; PDF und XML scheitern, bis die Schalter umgelegt sind */
  let mitERechnung = false;
  let pdf402 = false;
  let xml402 = false;

  const run = async () => {
    const id = await sevdesk.startSevdeskImport("test-user", { wait: true });
    const [row] = await sql`select error from lexoffice_imports where id = ${id}`;
    expect(row!.error).toBeNull();
  };
  const fileCheck = async () =>
    (await archiv.reconciliation()).years.find((y) => y.year === 2024)!.checks.find((c) => c.label === "Jeder Beleg hat eine Datei")!;

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    archiv = await import("./lexoffice.ts");
    offen = await import("./legacy-open.ts");
    const importPkg = await import("@haben/import");
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, 'einzelunternehmen')`;
    sevdesk.setSevdeskClientFactory(
      (o) =>
        new importPkg.SevdeskClient({
          ...o,
          minIntervalMs: 0,
          maxRetries: 0,
          sleep: async () => {},
          fetch: sevdeskFakeFetch(({ path, url, list }) => {
            switch (path) {
              case "/Invoice":
                return list(url.searchParams.get("invoiceType") ? [] : mitERechnung ? [rechnung, eRechnung] : [rechnung]);
              case "/Invoice/ID_401/getPdf":
                return pdf("RE-2024-0401");
              case "/Invoice/ID_402/getPdf":
                return pdf402 ? pdf("RE-2024-0402") : json({ error: {} }, 404);
              case "/Invoice/ID_402/getXml":
                return xml402
                  ? new Response("<?xml version='1.0'?><Invoice/>", { status: 200, headers: { "content-type": "application/xml" } })
                  : json({ error: { message: "Serverfehler" } }, 500);
              case "/Invoice/ID_401/getXml":
                return json({ error: { message: xmlStatus === 404 ? "keine E-Rechnung" : "Serverfehler" } }, xmlStatus);
            }
          }),
        }),
    );
    await sevdesk.saveSevdeskKey("test-user", TOKEN);
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("gibt den Stand „Anhang fehlt“ frei, wenn sevDesk beim nächsten Abruf ohne Fehler kein XML führt", async () => {
    await run();
    expect((await fileCheck()).ok).toBe(false);
    xmlStatus = 404;
    await run();
    const [row] = await archiv.listLegacyVouchers({ year: 2024, direction: "alle", search: "", ohneDatei: false });
    expect(row!.fileStatus).toBe("vollstaendig");
    expect(await fileCheck()).toMatchObject({ ok: true });
    const item = (await offen.openItemsOverview()).items.find((i) => i.number === "RE-2024-0401");
    expect(item?.blocker ?? "").not.toContain("XML");
  });

  it("findet mit dem Filter „Ohne Datei“ auch Belege hinter den ersten 1000 des Jahres", async () => {
    const [imp] = await sql`insert into lexoffice_imports (source, status, progress) values ('lexoffice', 'fertig', '{}') returning id`;
    // 1000 Buchungen ohne Beleg am Jahresanfang, dann ein Beleg ohne Datei im Dezember
    await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, raw)
      select 'lx-' || n, 'lexoffice', ${imp!.id}, 'purchaseinvoice', 'ausgabe', 'A-' || lpad(n::text, 4, '0'), '2024-01-02', 'paid', 100, 0, 100, '[]', '[]',
        '{"ohneBeleg": true}'::jsonb
      from generate_series(1, 1000) n`;
    await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, raw)
      values ('lx-dezember', 'lexoffice', ${imp!.id}, 'purchaseinvoice', 'ausgabe', 'Z-0001', '2024-12-30', 'paid', 100, 0, 100, '[]', '[]', '{}'::jsonb)`;
    const rows = await archiv.listLegacyVouchers({ year: 2024, direction: "alle", search: "", ohneDatei: true });
    expect(rows.map((r) => r.number)).toContain("Z-0001");
  });

  it("verfolgt PDF und XML getrennt: das nachgeladene PDF verdeckt kein fehlendes XML", async () => {
    mitERechnung = true;
    await run();
    const status = async () => (await archiv.listLegacyVouchers({ year: 2024, direction: "alle", search: "RE-2024-0402", ohneDatei: false }))[0]!.fileStatus;
    expect(await status()).toBe("abruf_fehlgeschlagen");
    pdf402 = true;
    await run();
    expect(await status()).toBe("anhang_fehlt");
    expect((await fileCheck()).ok).toBe(false);
    xml402 = true;
    await run();
    expect(await status()).toBe("vollstaendig");
    const roles = await sql`select f.role from lexoffice_voucher_files f join lexoffice_vouchers v on v.id = f.voucher_id
      where v.lexoffice_id = 'invoice/ID_402' order by 1`;
    expect(roles.map((r) => r.role)).toEqual(["pdf", "xml"]);
  });
});
