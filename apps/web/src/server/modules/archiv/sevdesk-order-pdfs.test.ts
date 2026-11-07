import type postgres from "postgres";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("sevdesk-Auftrags-PDFs nur für geprüfte Buchhaltung V1 (Postgres)", () => {
  let sql: postgres.Sql;
  let sevdesk: typeof import("./sevdesk.ts");
  let version = "1.0";
  let versionError = 0;
  let sourceChanged = false;
  let changeOnPdf = false;
  let pdfError = 0;
  let afterError = false;
  let requested = false;
  let changeVersionOnPdf = false;
  let changeContentOnPdf = false;
  let header = "Original";
  let serial = 0;
  let ids: string[];
  const calls: string[] = [];
  const source = (id: string) => ({
    id,
    orderType: "AN",
    orderNumber: `AN-${id}`,
    orderDate: "2026-10-01",
    status: sourceChanged ? "200" : "100",
    version: "0",
    update: "2026-10-01T10:00:00+02:00",
    sendDate: null,
    sendType: null,
    currency: "EUR",
    sumNet: "100",
    sumTax: "19",
    sumGross: "119",
    header,
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    const { SevdeskClient } = await import("@haben/import");
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/api/v1", "");
      calls.push(path);
      const json = (objects: unknown, status = 200) => new Response(JSON.stringify({ objects }), { status, headers: { "content-type": "application/json" } });
      if (path === "/Tools/bookkeepingSystemVersion") return json({ version }, versionError || 200);
      if (path === "/Order") return json(url.searchParams.get("offset") === "0" ? ids.map(source) : []);
      if (path.endsWith("/getPdf")) {
        expect(url.searchParams.get("preventSendBy")).toBe("true");
        expect(init?.redirect).toBe("error");
        requested = true;
        if (changeVersionOnPdf) version = "2.0";
        if (changeContentOnPdf) header = "Geändert";
        if (changeOnPdf) sourceChanged = true;
        return json(
          { filename: "original.pdf", mimetype: "application/pdf", base64Encoded: true, content: Buffer.from(`%PDF-1.4\n${path}\n%%EOF`).toString("base64") },
          pdfError || 200,
        );
      }
      if (/^\/Order\/[^/]+$/.test(path)) {
        if (afterError && requested) return json([], 503);
        return json([source(path.split("/").at(-1)!)]);
      }
      return json([]);
    }) as typeof fetch;
    sevdesk.setSevdeskClientFactory((options) => new SevdeskClient({ ...options, fetch: fetchFn, minIntervalMs: 0, maxRetries: 0 }));
    // Absichtlich V1 gespeichert: spätere Tests müssen eine frisch ermittelte V2 trotzdem ablehnen.
    await sevdesk.saveSevdeskKey("test-user", "0123456789abcdef0123456789abcdef");
  }, 30_000);

  beforeEach(() => {
    ids = [String(++serial)];
    calls.length = 0;
    version = "1.0";
    versionError = 0;
    sourceChanged = false;
    changeOnPdf = false;
    pdfError = 0;
    afterError = false;
    requested = false;
    changeVersionOnPdf = false;
    changeContentOnPdf = false;
    header = "Original";
  });
  afterAll(async () => {
    await sql?.end();
  });

  it("ergänzt V1-Entwurfs-PDFs automatisch und erhält vor/nach als unveränderlichen Nachweis", async () => {
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    const [file] = await sql`select f.* from legacy_order_files f join legacy_order_documents d on d.id = f.order_id where d.external_id = ${ids[0]!}`;
    expect(file).toMatchObject({ origin: "sevdesk", mime_type: "application/pdf" });
    expect(calls.filter((p) => p.endsWith("/getPdf"))).toHaveLength(1);
    const [proof] = await sql`select a.* from legacy_order_pdf_attempts a join legacy_order_documents d on d.id = a.order_id where d.external_id = ${ids[0]!}`;
    expect(proof).toMatchObject({ bookkeeping_version: "1.0", before: { status: "100" }, after: { status: "100" }, error: null });
    await expect(sql`update legacy_order_pdf_attempts set error = 'ersetzt'`).rejects.toThrow();
    await expect(sql`delete from legacy_order_pdf_attempts`).rejects.toThrow();
    const count = calls.length;
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect(calls.slice(count).some((p) => p.endsWith("/getPdf"))).toBe(false);
  });

  it.each(["2.0", "", "3.0", "1"])("ruft trotz früher gespeicherter V1 bei aktueller Version %s kein PDF ab", async (current) => {
    version = current;
    const options = { wait: true, orderPdfs: true };
    await sevdesk.startSevdeskImport("test-user", options);
    expect(calls).toContain("/Tools/bookkeepingSystemVersion");
    expect(calls.some((p) => p.endsWith("/getPdf"))).toBe(false);
    expect((await sql`select status from legacy_order_documents where external_id = ${ids[0]!}`)[0]!.status).toBe("100");
    expect((await sevdesk.latestSevdeskImport())!.progress.failed).toMatchObject([{ message: expect.stringMatching(/Buchhaltungsversion|Version/) }]);
  });

  it("lässt bei fehlgeschlagener Versionsprüfung PDFs aus und archiviert dennoch Metadaten", async () => {
    versionError = 503;
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect(calls.some((p) => p.endsWith("/getPdf"))).toBe(false);
    expect((await sql`select count(*)::int as n from legacy_order_documents where external_id = ${ids[0]!}`)[0]!.n).toBe(1);
    expect((await sevdesk.latestSevdeskImport())!.progress.failed).toHaveLength(1);
  });

  it("meldet ein übernommenes Dokument ohne PDF als „Dokument importiert, PDF fehlt“", async () => {
    pdfError = 503;
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    const { progress } = (await sevdesk.latestSevdeskImport())!;
    expect((await sql`select count(*)::int as n from legacy_order_documents where external_id = ${ids[0]!}`)[0]!.n).toBe(1);
    expect(progress.imported).toBeGreaterThanOrEqual(1);
    expect(progress.failed).toMatchObject([{ lexofficeId: `order/${ids[0]}`, message: expect.stringMatching(/^Dokument importiert, PDF fehlt: /) }]);
  });

  it("ordnet einen seit Archivierung veränderten Quellstand keinem alten Dokument zu", async () => {
    version = "2.0";
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    version = "1.0";
    sourceChanged = true;
    calls.length = 0;
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect(calls.some((p) => p.endsWith("/getPdf"))).toBe(false);
    const [document] = await sql`select status from legacy_order_documents where external_id = ${ids[0]!}`;
    expect(document!.status).toBe("100");
    expect((await sevdesk.latestSevdeskImport())!.progress.failed).toMatchObject([{ message: expect.stringContaining("seit Archivierung verändert") }]);
  });

  it("erkennt vor dem Abruf auch geänderten Kopftext ohne neue Status- oder Versionsnummer", async () => {
    version = "2.0";
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    version = "1.0";
    header = "Neuer Kopftext";
    calls.length = 0;
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect(calls.some((p) => p.endsWith("/getPdf"))).toBe(false);
    expect((await sevdesk.latestSevdeskImport())!.progress.failed).toMatchObject([{ message: expect.stringContaining("seit Archivierung verändert") }]);
  });

  it("ersetzt ein manuell nachgereichtes Original nicht durch einen späteren automatischen Abruf", async () => {
    version = "2.0";
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    const [document] = await sql`select id from legacy_order_documents where external_id = ${ids[0]!}`;
    const { attachOrderPdf } = await import("./orders.ts");
    await attachOrderPdf("test-user", document!.id, { filename: "original.pdf", bytes: new TextEncoder().encode("%PDF-1.4 manuell") });
    version = "1.0";
    calls.length = 0;
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect(calls.some((p) => p.endsWith("/getPdf"))).toBe(false);
    expect(await sql`select origin from legacy_order_files where order_id = ${document!.id}`).toMatchObject([{ origin: "manuell" }]);
  });

  it("beendet den Import bei einem Authentifizierungsfehler des PDF-Abrufs", async () => {
    pdfError = 401;
    ids.push(String(++serial));
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect((await sevdesk.latestSevdeskImport())!.status).toBe("fehler");
    expect(calls.filter((p) => p.endsWith("/getPdf"))).toHaveLength(1);
  });

  it.each(["änderung", "inhalt", "pdf-fehler", "nachkontrolle"])("stoppt nach %s weitere PDFs und bewahrt den Abrufnachweis", async (kind) => {
    ids.push(String(++serial));
    changeOnPdf = kind === "änderung";
    changeContentOnPdf = kind === "inhalt";
    pdfError = kind === "pdf-fehler" ? 503 : 0;
    afterError = kind === "nachkontrolle";
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect(calls.filter((p) => p.endsWith("/getPdf"))).toHaveLength(1);
    expect(calls.filter((p) => p === `/Order/${ids[0]}`)).toHaveLength(2);
    const [proof] = await sql`select a.* from legacy_order_pdf_attempts a join legacy_order_documents d on d.id = a.order_id where d.external_id = ${ids[0]!}`;
    expect(proof!.before.status).toBe("100");
    expect(proof!.error).toBeTruthy();
    expect(proof!.after).toEqual(kind === "nachkontrolle" ? null : expect.objectContaining({ status: kind === "änderung" ? "200" : "100" }));
    expect(
      (
        await sql`select count(*)::int as n from legacy_order_files f join legacy_order_documents d on d.id = f.order_id where d.external_id in (${ids[0]!},${ids[1]!})`
      )[0]!.n,
    ).toBe(0);
    expect((await sevdesk.latestSevdeskImport())!.progress.failed).toHaveLength(1);
  });

  it("prüft die Version vor jedem PDF erneut und stoppt bei einem Wechsel auf V2", async () => {
    ids.push(String(++serial));
    changeVersionOnPdf = true;
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect(calls.filter((p) => p.endsWith("/getPdf"))).toHaveLength(1);
    expect(calls.filter((p) => p === "/Tools/bookkeepingSystemVersion")).toHaveLength(2);
    expect((await sevdesk.latestSevdeskImport())!.progress.failed).toMatchObject([{ message: expect.stringContaining("Buchhaltungsversion 2.0") }]);
  });

  it("exportiert erfolgreiche und fehlgeschlagene Abrufnachweise im Jahresarchiv", async () => {
    const { exportYear } = await import("./export.ts");
    const chunks: Uint8Array[] = [];
    for await (const chunk of exportYear(2026)) chunks.push(chunk);
    const zip = unzipSync(Buffer.concat(chunks));
    const proofs = Object.entries(zip)
      .filter(([path]) => path.endsWith("/pdf-abrufe.json"))
      .flatMap(([, bytes]) => JSON.parse(new TextDecoder().decode(bytes)));
    expect(proofs.some((proof) => proof.bookkeepingVersion === "1.0" && proof.before.status === "100" && proof.error === null)).toBe(true);
    expect(proofs.some((proof) => proof.error !== null && proof.after === null)).toBe(true);
  });
});
