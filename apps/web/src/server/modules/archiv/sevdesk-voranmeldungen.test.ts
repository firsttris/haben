import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import zeitraeume from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/vat-report-zeitraeume.json" with { type: "json" };
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Übermittelte Voranmeldungen aus sevDesk (#472): nur Archiv mit Protokoll, ohne Wirkung auf die Voranmeldungen in
 * Haben. Antworten wie in test-fixtures/sevdesk/buchhaltung-1.0/vat-report-zeitraeume.json (Kz 83 dort 100,00 €).
 */

const TOKEN = "0123456789abcdef0123456789abcdef";
const PDF = (text: string) => new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`);
const REPORTS = zeitraeume.objects as Record<string, unknown>[];
const TESTFALL = { ...REPORTS[0]!, id: "ID_90", testCase: "1", document: { id: "ID_91", objectName: "Document" } };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeApi(reports: unknown[], ohneProtokoll: string[] = [], vatReportFehler = false) {
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/v1/, "");
    calls.push(path);
    if (new Headers(init?.headers).get("authorization") !== TOKEN) return json({ error: { message: "Authentication required" } }, 401);
    const list = (objects: unknown[]) => json({ objects: url.searchParams.get("offset") === "0" ? objects : [] });
    if (path === "/Tools/bookkeepingSystemVersion") return json({ objects: { version: "1.0" } });
    if (path === "/VatReport") return vatReportFehler ? json({ error: { message: "kaputt" } }, 500) : list(reports);
    const download = /^\/Document\/(\w+)\/download$/.exec(path);
    if (download) {
      if (ohneProtokoll.includes(download[1]!)) return json({ error: { message: "nicht gefunden" } }, 404);
      // Hülle wie test-fixtures/sevdesk/buchhaltung-1.0/document-download.json
      return json({ objects: { filename: "x", mimetype: "application/pdf", base64Encoded: true, content: Buffer.from(PDF(download[1]!)).toString("base64") } });
    }
    if (path.startsWith("/") && !path.slice(1).includes("/")) return list([]);
    return json({ error: { message: `unbekannt ${path}` } }, 404);
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe.skipIf(!testDatabaseUrl)("Voranmeldungen aus sevDesk (Postgres)", { timeout: 30_000 }, () => {
  let sevdesk: typeof import("./sevdesk.ts");
  let archiv: typeof import("./voranmeldungen-archiv.ts");
  let vat: typeof import("../umsatzsteuer/vat.ts");
  let vermerk: typeof import("../umsatzsteuer/vermerk.ts");
  let importPkg: typeof import("@haben/import");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    archiv = await import("./voranmeldungen-archiv.ts");
    vat = await import("../umsatzsteuer/vat.ts");
    vermerk = await import("../umsatzsteuer/vermerk.ts");
    importPkg = await import("@haben/import");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function abruf(reports: unknown[], ohneProtokoll: string[] = [], vatReportFehler = false) {
    const api = fakeApi(reports, ohneProtokoll, vatReportFehler);
    sevdesk.setSevdeskClientFactory((o) => new importPkg.SevdeskClient({ ...o, fetch: api.fetchFn, minIntervalMs: 0, maxRetries: 0, sleep: async () => {} }));
    await sevdesk.startSevdeskImport(actor, { wait: true });
    return { api, run: (await sevdesk.latestSevdeskImport())! };
  }

  async function reset(versteuerung = "ist", kontenrahmen = "SKR03") {
    await leeren(sql)`truncate archive_files, legacy_vat_report_files, legacy_vat_reports, legacy_dunning_files, legacy_dunnings, vat_return_filings,
      vat_frequencies, vat_return_submissions, vat_returns, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, sevdesk_connection,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen})`;
    sevdesk.setSevdeskClientFactory((o) => new importPkg.SevdeskClient({ ...o, fetch: fakeApi([]).fetchFn, minIntervalMs: 0, maxRetries: 0 }));
    await sevdesk.saveSevdeskKey(actor, TOKEN);
  }

  it("archiviert jede übermittelte Voranmeldung mit Protokoll und unveränderter Antwort, ohne Testfälle", async () => {
    await reset();
    const { run, api } = await abruf([...REPORTS, TESTFALL]);
    expect(run.status).toBe("fertig");
    expect(run.progress.vatReports).toBe(5);
    expect(run.progress.failed).toEqual([]);
    expect(api.calls).not.toContain("/Document/ID_91/download");

    const rows = await sql`select external_id, year, month, period_text, actual_taxation, corrected, kz83, raw from legacy_vat_reports order by external_id`;
    expect(rows.map((r) => [r.external_id, r.year, r.month, r.actual_taxation, r.kz83])).toEqual([
      ["vatreport/ID_20", 2023, 42, false, 10000],
      ["vatreport/ID_22", 2023, 44, true, 10000],
      ["vatreport/ID_24", 2024, 4, true, 10000],
      ["vatreport/ID_26", 2026, 41, true, 10000],
      ["vatreport/ID_28", 2026, 8, true, 10000],
    ]);
    expect(rows[0]!.raw).toEqual(REPORTS[0]);
    expect((await sql`select filename from legacy_vat_report_files order by filename`).map((r) => r.filename)).toEqual([
      "UStVA_2023-Q2_Protokoll.pdf",
      "UStVA_2023-Q4_Protokoll.pdf",
      "UStVA_2024-04_Protokoll.pdf",
      "UStVA_2026-08_Protokoll.pdf",
      "UStVA_2026-Q1_Protokoll.pdf",
    ]);
    // Audit-Log trägt jede neue Zeile
    expect((await sql`select count(*)::int as n from audit_log where table_name in ('legacy_vat_reports', 'legacy_vat_report_files')`)[0]!.n).toBe(10);

    const [august] = (await archiv.legacyVatReports(2026)).filter((r) => r.month === 8);
    expect(august!.kennzahlen.map((k) => k.kz)).toEqual(["41", "42", "46", "47", "48", "61", "62", "66", "67", "81", "83", "86", "89"]);
    expect(august!.files).toHaveLength(1);
    expect(await archiv.legacyVatReportYears()).toEqual([2026, 2024, 2023]);
  });

  it("archivierte Voranmeldungen lassen sich nicht ändern oder löschen", async () => {
    await reset();
    await abruf(REPORTS.slice(0, 1));
    await expect(sql`update legacy_vat_reports set kz83 = 1`).rejects.toThrow();
    await expect(sql`delete from legacy_vat_reports`).rejects.toThrow();
    await expect(sql`delete from legacy_vat_report_files`).rejects.toThrow();
    await expect(sql`truncate legacy_vat_report_files`).rejects.toThrow();
  });

  it("holt nichts doppelt und lädt ein fehlendes Protokoll nach, ohne die Zeile zu ändern", async () => {
    await reset();
    const erster = await abruf(REPORTS.slice(0, 2), ["ID_21"]);
    expect(erster.run.progress.vatReports).toBe(2);
    expect((await sql`select count(*)::int as n from legacy_vat_report_files`)[0]!.n).toBe(1);
    const vorher = await sql`select * from legacy_vat_reports order by external_id`;

    const zweiter = await abruf(REPORTS.slice(0, 2));
    expect(zweiter.run.progress.vatReports ?? 0).toBe(0);
    expect(zweiter.api.calls.filter((c) => c.startsWith("/Document/"))).toEqual(["/Document/ID_21/download"]);
    expect(await sql`select * from legacy_vat_reports order by external_id`).toEqual(vorher);
    expect((await sql`select count(*)::int as n from legacy_vat_report_files`)[0]!.n).toBe(2);

    const dritter = await abruf(REPORTS.slice(0, 2));
    expect(dritter.api.calls.filter((c) => c.startsWith("/Document/"))).toEqual([]);
  });

  it("hält den Abruf bei einem Fehler nicht an", async () => {
    await reset();
    const kaputt = await abruf(REPORTS, [], true);
    expect(kaputt.run.status).toBe("fertig");
    expect(kaputt.run.progress.failed).toEqual([expect.objectContaining({ lexofficeId: "vatreport", number: "Voranmeldungen" })]);

    const ohneJahr = await abruf([{ ...REPORTS[0]!, id: "ID_80", reportingYear: "x" }, REPORTS[1]]);
    expect(ohneJahr.run.progress.failed).toEqual([expect.objectContaining({ lexofficeId: "vatreport/ID_80" })]);
    expect((await sql`select external_id from legacy_vat_reports`).map((r) => r.external_id)).toEqual(["vatreport/ID_22"]);
  });

  for (const [versteuerung, kontenrahmen] of [
    ["ist", "SKR03"],
    ["soll", "SKR04"],
  ] as const) {
    it(`ersetzt und sperrt keine eigene Voranmeldung für denselben Zeitraum (${versteuerung}, ${kontenrahmen})`, async () => {
      await reset(versteuerung, kontenrahmen);
      const august = { year: 2026, month: 8 };
      const vorher = await vat.computedValues(august);
      await abruf(REPORTS);
      expect(await vat.computedValues(august)).toEqual(vorher);
      expect((await sql`select count(*)::int as n from vat_returns`)[0]!.n).toBe(0);

      const draft = await vat.saveDraft(actor, august, { mode: "berechnet" });
      const abgegeben = await vermerk.vermerkeAbgabe(
        actor,
        draft.id,
        { filedOn: "2026-09-10", transferTicket: "et9k3m2x7q4w8z1a", kz83: draft.kz83, file: { bytes: PDF("Haben"), filename: "UStVA_2026-08.pdf" } },
        "2026-11-15",
      );
      expect(abgegeben.status).toBe("sent");
      // Das Archiv bleibt daneben unverändert
      expect((await sql`select count(*)::int as n from legacy_vat_reports where year = 2026 and month = 8`)[0]!.n).toBe(1);
    });
  }

  it("zählt die Protokolle im Abgleich je Jahr als ELSTER-Protokolle", async () => {
    await reset();
    const archive = await import("./archive.ts");
    const lexoffice = await import("./lexoffice.ts");
    await archive.addArchiveFile(actor, { bytes: PDF("Kontoauszug"), filename: "auszug.pdf", kind: "kontoauszug", year: 2026 });
    const elster = async () =>
      (await lexoffice.reconciliation()).years.find((y) => y.year === 2026)!.checks.find((c) => c.label === "ELSTER-Protokolle archiviert");
    expect(await elster()).toMatchObject({ ok: false, detail: "fehlen" });
    await abruf(REPORTS);
    expect(await elster()).toMatchObject({ ok: true, detail: "2 Dateien" });
  });

  it("nimmt Antwort, Protokoll und Übersicht in den Jahresexport des Zeitraums auf", async () => {
    await reset();
    await abruf(REPORTS, ["ID_27"]);
    const exporter = await import("./export.ts");
    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2026)) chunks.push(chunk);
    const files = unzipSync(Buffer.concat(chunks));
    const paths = Object.keys(files).filter((p) => p.startsWith("sevdesk/voranmeldungen"));
    expect(paths.filter((p) => p.endsWith("quelle.json"))).toHaveLength(2);
    expect(paths.filter((p) => p.endsWith(".pdf"))).toEqual([
      expect.stringMatching(/^sevdesk\/voranmeldungen\/2026-08_[0-9a-f]{8}\/[0-9a-f]{8}_UStVA_2026-08_Protokoll\.pdf$/),
    ]);
    const uebersicht = Buffer.from(files["sevdesk/voranmeldungen.csv"]!).toString("utf8");
    expect(uebersicht).toContain("2026-Q1");
    expect(uebersicht).toContain("83=100,00");
    // Fehlendes Protokoll steht in den Hinweisen; die Voranmeldungen aus 2023 gehören nicht in 2026
    const hinweise = Object.entries(files).find(([p]) => p === "FEHLER.txt");
    expect(hinweise && Buffer.from(hinweise[1]).toString("utf8")).toContain("sevdesk-Voranmeldung 2026-Q1: Übermittlungsprotokoll fehlt.");
    expect(uebersicht).not.toContain("2023-");
  });
});
