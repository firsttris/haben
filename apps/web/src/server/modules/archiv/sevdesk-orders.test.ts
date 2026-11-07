import type postgres from "postgres";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("sevdesk-Auftragsarchiv ohne Buchungswirkung (Postgres)", () => {
  let sql: postgres.Sql;
  let sevdesk: typeof import("./sevdesk.ts");
  const calls: string[] = [];
  let orderFailure: number | null = null;

  beforeAll(async () => {
    sql = await setupTestDb();
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban)
      values (1, 'Test', 'Straße 1', '93047', 'Regensburg', 'test@example.com', '', '198/113/10010', 'DE123456789', 'BY', '')`;
    sevdesk = await import("./sevdesk.ts");
    const { SevdeskClient } = await import("@haben/import");
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/api/v1", "");
      calls.push(path);
      if (path === "/Order" && orderFailure) return new Response(JSON.stringify({ error: { message: "Aufträge nicht verfügbar" } }), { status: orderFailure });
      const orders = ["AN", "AB", "LI"].map((orderType, i) => ({
        id: String(i + 1),
        orderType,
        orderNumber: `${orderType}-2026-1`,
        orderDate: "2026-10-01",
        status: ["200", "750", "1000"][i],
        address: "Archivkunde",
        currency: "EUR",
        sumNet: "100",
        sumTax: "19",
        sumGross: "119",
        origin: null,
      }));
      if (path.endsWith("/getPdf")) {
        throw new Error("Auftrags-PDF ohne vollständigen Nachweis abgerufen");
      }
      const objects =
        path === "/Tools/bookkeepingSystemVersion"
          ? { version: "2.0" }
          : path === "/Order"
            ? url.searchParams.get("offset") === "0"
              ? [...orders, { ...orders[0], id: "4", orderNumber: "AN-ENTWURF", status: "100" }]
              : []
            : /^\/Order\/\d+$/.test(path)
              ? orders.filter((o) => o.id === path.split("/").at(-1))
              : path.endsWith("/getPositions")
                ? [{ id: "1", name: "Leistung", quantity: "2", price: "50", taxRate: "19" }]
                : path === "/Order/2/getRelatedObjects"
                  ? {
                      "0": { id: "81", objectName: "Invoice", invoiceNumber: "RE-2026-1", status: "1000", sumGross: "59.50" },
                      "3": { id: "92", objectName: "Order", orderType: "LI", orderNumber: "LS-2026-1" },
                    }
                  : [];
      return new Response(JSON.stringify({ objects }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    sevdesk.setSevdeskClientFactory((options) => new SevdeskClient({ ...options, fetch: fetchFn, minIntervalMs: 0, maxRetries: 0 }));
    await sevdesk.saveSevdeskKey("test-user", "0123456789abcdef0123456789abcdef");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("ignoriert eine unbelegte PDF-Freigabe und bleibt auch bei zusätzlichen Aufrufdaten rein lesend", async () => {
    const options = { wait: true, orderPdfs: true };
    await sevdesk.startSevdeskImport("test-user", options);
    expect(calls.filter((path) => path.endsWith("/getPdf"))).toHaveLength(0);
  });

  it("archiviert alle drei Auftragsarten samt Entwurf und erhält die Finanzbücher unverändert", async () => {
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect(calls).toContain("/Order");
    const orders = await sql`select kind, number, status, raw from legacy_order_documents order by external_id`;
    expect(orders.map((o) => o.kind)).toEqual(["AN", "AB", "LI", "AN"]);
    expect(orders.map((o) => o.status)).toEqual(["200", "750", "1000", "100"]);
    expect(orders[0]!.raw.positions).toMatchObject([{ name: "Leistung", quantity: "2", price: "50" }]);
    for (const table of ["lexoffice_vouchers", "invoices", "quotes", "journal_entries", "allocations"]) {
      expect(Number((await sql.unsafe(`select count(*) as n from ${table}`))[0]!.n)).toBe(0);
    }
    expect(calls.some((p) => p.endsWith("/getPdf"))).toBe(false);
  });

  it("erzeugt beim erneuten Abruf keine doppelten Archivdokumente", async () => {
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect(Number((await sql`select count(*) as n from legacy_order_documents`)[0]!.n)).toBe(4);
  });

  it("schützt Archivdokumente vor Überschreiben und Löschen", async () => {
    await expect(sql`update legacy_order_documents set number = 'geändert'`).rejects.toThrow();
    await expect(sql`delete from legacy_order_documents`).rejects.toThrow();
  });

  it("weist fehlende PDFs einschließlich Entwürfen aus und bewahrt Teilberechnung mit Rechnungsbeziehungen", async () => {
    const archive = await import("./orders.ts");
    expect(await archive.orderArchiveOverview()).toMatchObject({ count: 4, withoutPdf: 4, years: [2026] });
    const [order] = await sql`select id, status, raw from legacy_order_documents where external_id = '2'`;
    expect(order!.status).toBe("750");
    expect(order!.raw.relatedObjects).toEqual({
      "0": { id: "81", objectName: "Invoice", invoiceNumber: "RE-2026-1", status: "1000", sumGross: "59.50" },
      "3": { id: "92", objectName: "Order", orderType: "LI", orderNumber: "LS-2026-1" },
    });
    expect((await archive.orderDocumentDetail(order!.id))!.document.relatedObjects).toBe(JSON.stringify(order!.raw.relatedObjects));
    expect(calls.filter((p) => p.endsWith("/getPdf"))).toHaveLength(0);
  });

  it("hängt manuelle PDFs nachvollziehbar an und schützt auch nachgereichte Dateien", async () => {
    const archive = await import("./orders.ts");
    const [document] = await sql`select id from legacy_order_documents where external_id = '1'`;
    const file = { bytes: new TextEncoder().encode("%PDF-1.4\nNachtrag\n%%EOF"), filename: "nachgereicht.pdf" };
    expect(await archive.attachOrderPdf("test-user", document!.id, file)).toEqual({ added: true });
    expect(await archive.attachOrderPdf("test-user", document!.id, file)).toEqual({ added: false });
    expect(await archive.attachOrderPdf("test-user", document!.id, { ...file, bytes: new TextEncoder().encode("%PDF-1.4\nZweiter Nachtrag\n%%EOF") })).toEqual({
      added: true,
    });
    await expect(archive.attachOrderPdf("test-user", document!.id, { bytes: new Uint8Array([1, 2]), filename: "fake.pdf" })).rejects.toThrow(/PDF/);
    await expect(sql`update legacy_order_files set filename = 'ersetzt.pdf'`).rejects.toThrow();
    await expect(sql`delete from legacy_order_files`).rejects.toThrow();
    const detail = await archive.orderDocumentDetail(document!.id);
    expect(detail!.files).toHaveLength(2);
    expect(detail!.document.positions).toMatchObject([{ name: "Leistung", quantity: "2" }]);
    const rows = await archive.listOrderDocuments({ year: 2026, search: "AN-2026-1", kind: "AN" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.files).toBe(2);
  });

  it("exportiert Quelldaten und alle Dateistände ohne sie in Finanzbelege einzuschleusen", async () => {
    const exporter = await import("./export.ts");
    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2026)) chunks.push(chunk);
    const files = unzipSync(Buffer.concat(chunks));
    expect(files["sevdesk/auftraege.csv"]).toBeDefined();
    expect(Object.keys(files).filter((path) => path.endsWith("/quelle.json"))).toHaveLength(4);
    expect(Object.keys(files).filter((path) => path.startsWith("sevdesk/auftraege/") && path.endsWith(".pdf"))).toHaveLength(2);
    const sources = Object.entries(files)
      .filter(([path]) => path.endsWith("/quelle.json"))
      .map(([, bytes]) => JSON.parse(new TextDecoder().decode(bytes)));
    expect(sources.find((source) => source.order.id === "2").relatedObjects["0"].invoiceNumber).toBe("RE-2026-1");
    expect(files["lexoffice/belege.csv"]).toBeUndefined();
  });

  it("zählt vorhandene PDFs in der Vollständigkeitsübersicht nur beim zugehörigen Auftrag", async () => {
    const archive = await import("./orders.ts");
    expect(await archive.orderArchiveOverview()).toMatchObject({ count: 4, withoutPdf: 3 });
    expect((await archive.listOrderDocuments({ year: 2026, search: "", kind: "AB" }))[0]!.files).toBe(0);
  });

  it("setzt den Fachbelegimport bei nicht verfügbarem Order-Endpunkt mit sichtbarem Hinweis fort", async () => {
    orderFailure = 404;
    try {
      await sevdesk.startSevdeskImport("test-user", { wait: true });
      const last = (await sevdesk.latestSevdeskImport())!;
      expect(last.status).toBe("fertig");
      expect(last.progress.failed).toMatchObject([{ lexofficeId: "order", message: expect.stringContaining("/Order") }]);
    } finally {
      orderFailure = null;
    }
  });
});
