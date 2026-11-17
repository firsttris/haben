import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import antworten from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/dateistand.json";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #345: Drei Zustände fehlender Dateien aus sevDesk, getrennt in Fortschritt, Belegansicht, Abgleich und Export.
 * 1. Beleg ohne `document`: ohne Datei, offen bis zur Bestätigung durch eine Person (ein leerer Verweis beweist nichts).
 * 2. Datei genannt bzw. Rechnungs-PDF Pflicht, Abruf scheitert: Fehler mit Quell-ID, ein späterer Abruf lädt nach.
 * 3. PDF da, XML fehlt: fehlender Anhang.
 * Eine Rechnung lässt sich nie als „ohne Datei“ bestätigen. Der Abgleich ist unabhängig von Kontenrahmen und Versteuerung;
 * er läuft für SKR03 mit Ist und SKR04 mit Soll.
 */

type Raw = Record<string, unknown>;
const fx = antworten as unknown as {
  belegMitDatei: { voucher: Raw; dokument: Raw };
  belegOhneDatei: { voucher: Raw };
  rechnungMitDokument: { invoice: Raw };
};
const TOKEN = "0123456789abcdef0123456789abcdef";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const pdf = (text: string) =>
  json({
    objects: { base64Encoded: true, content: Buffer.from(`%PDF-1.4\n% ${text}\n`).toString("base64"), filename: `${text}.pdf`, mimetype: "application/pdf" },
  });
const xml = () => new Response("<?xml version='1.0'?><Invoice/>", { status: 200, headers: { "content-type": "application/xml" } });

// Beleg mit Datei (Abruf scheitert erst), Beleg ohne document, Beleg mit funktionierender Datei
const mitDatei = { ...fx.belegMitDatei.voucher, id: "ID_101", description: "B-2024-0001", voucherDate: "2024-03-01T00:00:00+01:00" };
const ohneDatei = { ...fx.belegOhneDatei.voucher, id: "ID_102", description: "B-2024-0002", voucherDate: "2024-03-02T00:00:00+01:00" };
const gut = { ...fx.belegMitDatei.voucher, id: "ID_103", description: "B-2024-0003", document: { id: "ID_203", objectName: "Document" } };
// Rechnung ohne PDF und Rechnung, deren XML scheitert
const ohnePdf = { ...fx.rechnungMitDokument.invoice, id: "ID_301", invoiceNumber: "RE-2024-0001", invoiceDate: "2024-03-05T00:00:00+01:00" };
const ohneXml = { ...fx.rechnungMitDokument.invoice, id: "ID_302", invoiceNumber: "RE-2024-0002", invoiceDate: "2024-03-06T00:00:00+01:00" };

describe.skipIf(!testDatabaseUrl).each([
  ["SKR03", "ist"],
  ["SKR04", "soll"],
] as const)("sevDesk: Dateistand der Belege, %s und %s (Postgres)", (kontenrahmen, versteuerung) => {
  let sql: postgres.Sql;
  let sevdesk: typeof import("./sevdesk.ts");
  let archiv: typeof import("./lexoffice.ts");
  let dateistand: typeof import("./dateistand.ts");
  let exporter: typeof import("./export.ts");
  /** Abrufe, die gerade scheitern; ein zweiter Lauf leert die Menge */
  const broken = new Set(["/Document/ID_5/download", "/Invoice/ID_301/getPdf", "/Invoice/ID_302/getXml"]);
  const calls: string[] = [];

  const idOf = async (lexofficeId: string) => String((await sql`select id from lexoffice_vouchers where lexoffice_id = ${lexofficeId}`)[0]!.id);
  const fileCheck = async () => {
    const year = (await archiv.reconciliation()).years.find((y) => y.year === 2024)!;
    return year.checks.find((c) => c.label === "Jeder Beleg hat eine Datei")!;
  };
  const run = async () => {
    const id = await sevdesk.startSevdeskImport("test-user", { wait: true });
    const [row] = await sql`select status, error, progress from lexoffice_imports where id = ${id}`;
    expect(row!.error).toBeNull();
    return row!.progress as { sevdeskFiles: Record<string, number>; failed: unknown[] };
  };

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    archiv = await import("./lexoffice.ts");
    dateistand = await import("./dateistand.ts");
    exporter = await import("./export.ts");
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
          fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
            expect(init?.method ?? "GET").toBe("GET");
            const url = new URL(String(input));
            const path = url.pathname.replace(/^\/api\/v1/, "");
            calls.push(path);
            const list = (objects: unknown[]) => json({ objects: url.searchParams.get("offset") === "0" ? objects : [] });
            if (broken.has(path)) return path.endsWith("getXml") ? json({ error: { message: "Serverfehler" } }, 500) : json({ error: {} }, 404);
            switch (path) {
              case "/Tools/bookkeepingSystemVersion":
                return json({ objects: { version: "1.0" } });
              case "/Voucher":
                return list([mitDatei, ohneDatei, gut]);
              case "/Invoice":
                return list(url.searchParams.get("invoiceType") ? [] : [ohnePdf, ohneXml]);
              case "/Document/ID_5/download":
                return pdf("beleg-101");
              case "/Document/ID_203/download":
                return pdf("beleg-103");
              case "/Invoice/ID_301/getPdf":
                return pdf("RE-2024-0001");
              case "/Invoice/ID_302/getPdf":
                return pdf("RE-2024-0002");
              case "/Invoice/ID_301/getXml":
                return json({ error: {} }, 404);
              case "/Invoice/ID_302/getXml":
                return xml();
            }
            if (
              /^\/(Contact|ContactAddress|CommunicationWay|CreditNote|Order|CheckAccount|CheckAccountTransactionLog|VoucherPos|VatReport|Part|TaxSet)$/.test(
                path,
              )
            )
              return list([]);
            if (/^\/Invoice\/[^/]+\/getPositions$/.test(path)) return list([]);
            return json({ error: { message: `unbekannt ${path}` } }, 404);
          }) as typeof fetch,
        }),
    );
    await sevdesk.saveSevdeskKey("test-user", TOKEN);
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("hält beim ersten Abruf die drei Zustände getrennt fest", async () => {
    const progress = await run();
    expect(progress.failed).toEqual([]);
    expect(progress.sevdeskFiles).toEqual({ ohneDatei: 1, abrufFehlgeschlagen: 2, anhangFehlt: 1, nachgeladen: 0 });
    const states = await sql`select v.lexoffice_id as voucher, s.state, s.role, s.source_file_id as "sourceFileId"
      from legacy_file_states s join lexoffice_vouchers v on v.id = s.voucher_id order by 1`;
    expect(states).toEqual([
      { voucher: "invoice/ID_301", state: "abruf_fehlgeschlagen", role: "pdf", sourceFileId: null },
      { voucher: "invoice/ID_302", state: "anhang_fehlt", role: "xml", sourceFileId: null },
      { voucher: "voucher/ID_101", state: "abruf_fehlgeschlagen", role: "anhang", sourceFileId: "ID_5" },
      { voucher: "voucher/ID_102", state: "ohne_datei", role: null, sourceFileId: null },
    ]);
  });

  it("zählt im Abgleich jeden Zustand einzeln und lässt das Jahr offen", async () => {
    expect(await fileCheck()).toEqual({
      ok: false,
      label: "Jeder Beleg hat eine Datei",
      detail: "2 Abruf fehlgeschlagen, 1 laut sevDesk ohne Datei, nicht bestätigt, 1 mit fehlendem Anhang",
    });
    const list = await archiv.listLegacyVouchers({ year: 2024, direction: "alle", search: "", ohneDatei: true });
    expect(list.map((r) => [r.number, r.fileStatus])).toEqual([
      ["B-2024-0001", "abruf_fehlgeschlagen"],
      ["B-2024-0002", "ohne_datei_offen"],
      ["RE-2024-0001", "abruf_fehlgeschlagen"],
      ["RE-2024-0002", "anhang_fehlt"],
    ]);
  });

  it("lässt eine Rechnung ohne PDF und einen fehlgeschlagenen Abruf nicht als ohne Datei bestätigen", async () => {
    await expect(dateistand.confirmWithoutFile("test-user", await idOf("invoice/ID_301"), "")).rejects.toThrow("Original-PDF");
    await expect(dateistand.confirmWithoutFile("test-user", await idOf("voucher/ID_101"), "")).rejects.toThrow("sevDesk nennt zu diesem Beleg eine Datei");
    await expect(dateistand.confirmWithoutFile("test-user", await idOf("voucher/ID_103"), "")).rejects.toThrow("hat eine Datei");
  });

  it("bestätigt einen Beleg ohne Datei mit Person und Herkunft; der Abgleich zählt ihn getrennt", async () => {
    const id = await idOf("voucher/ID_102");
    await dateistand.confirmWithoutFile("test-user", id, "Kassenbon verloren");
    await expect(dateistand.confirmWithoutFile("test-user", id, "")).rejects.toThrow("Schon bestätigt");
    const detail = (await archiv.legacyVoucherDetail(id))!;
    expect(detail.fileState).toMatchObject({ status: "ohne_datei_bestaetigt", canConfirmWithoutFile: false });
    expect(detail.fileState.history.at(-1)).toMatchObject({
      state: "bestaetigt_ohne_datei",
      message: "In sevDesk geprüft: Kassenbon verloren",
      by: "test-user",
    });
    expect((await fileCheck()).detail).toBe("2 Abruf fehlgeschlagen, 1 mit fehlendem Anhang, 1 ohne Datei (bestätigt)");
    const list = await archiv.listLegacyVouchers({ year: 2024, direction: "alle", search: "", ohneDatei: true });
    expect(list.map((r) => r.number)).not.toContain("B-2024-0002");
  });

  it("lädt beim nächsten Abruf die fehlenden Dateien an denselben Beleg nach, ohne Dubletten und ohne die Archivkopie zu ändern", async () => {
    const before = await sql`select id, raw, net, gross from lexoffice_vouchers order by lexoffice_id`;
    broken.clear();
    calls.length = 0;
    const progress = await run();
    expect(progress.sevdeskFiles).toEqual({ ohneDatei: 0, abrufFehlgeschlagen: 0, anhangFehlt: 0, nachgeladen: 3 });
    expect(await sql`select id, raw, net, gross from lexoffice_vouchers order by lexoffice_id`).toEqual(before);
    const files = await sql`select v.lexoffice_id as voucher, f.role, f.lexoffice_file_id as "fileId" from lexoffice_voucher_files f
      join lexoffice_vouchers v on v.id = f.voucher_id order by 1, 2`;
    expect(files).toEqual([
      { voucher: "invoice/ID_301", role: "pdf", fileId: null },
      { voucher: "invoice/ID_302", role: "pdf", fileId: null },
      { voucher: "invoice/ID_302", role: "xml", fileId: null },
      { voucher: "voucher/ID_101", role: "anhang", fileId: "ID_5" },
      { voucher: "voucher/ID_103", role: "anhang", fileId: "ID_203" },
    ]);
    expect(await fileCheck()).toMatchObject({ ok: true, detail: "1 ohne Datei (bestätigt), übrige mit Datei" });
    // Ein dritter Lauf fragt nichts mehr nach und schreibt keinen Stand doppelt
    calls.length = 0;
    const [{ n }] = (await sql`select count(*)::int as n from legacy_file_states`) as unknown as [{ n: number }];
    await run();
    expect(calls.filter((p) => /download|getPdf|getXml/.test(p))).toEqual([]);
    expect((await sql`select count(*)::int as n from legacy_file_states`)[0]!.n).toBe(n);
  });

  it("ordnet einen Beleg aus einem Abruf vor #345 nachträglich ein", async () => {
    const [run1] = await sql`select id from lexoffice_imports order by started_at limit 1`;
    await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, raw)
      values ('voucher/ID_104', 'sevdesk', ${run1!.id}, 'purchaseinvoice', 'ausgabe', 'B-2024-0004', '2024-03-09', 'paid', 100, 0, 100, '[]', '[]',
      ${JSON.stringify({ ...ohneDatei, id: "ID_104" })}::jsonb)`;
    expect((await run()).sevdeskFiles).toMatchObject({ ohneDatei: 1 });
    expect((await archiv.legacyVoucherDetail(await idOf("voucher/ID_104")))!.fileState).toMatchObject({
      status: "ohne_datei_offen",
      canConfirmWithoutFile: true,
    });
  });

  it("führt den Dateistand im Jahresexport", async () => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2024, new Date("2026-11-15T10:00:00Z"))) chunks.push(chunk);
    const files = unzipSync(Buffer.concat(chunks));
    const belege = new TextDecoder().decode(files["lexoffice/belege.csv"]);
    expect(belege.split("\n")[0]).toMatch(/;Dateistand\r?$/);
    expect(belege).toContain("ohne Datei, bestätigt");
    const verlauf = new TextDecoder().decode(files["lexoffice/dateistand.csv"]);
    expect(verlauf).toContain("ohne Datei bestätigt");
    expect(verlauf).toContain("In sevDesk geprüft: Kassenbon verloren");
    expect(verlauf).toContain("Datei nachgeladen");
  });

  it("hängt den Dateistand nur an", async () => {
    await expect(sql`update legacy_file_states set message = 'x'`).rejects.toThrow();
    await expect(sql`delete from legacy_file_states`).rejects.toThrow();
  });
});
