import { computeInvoiceTotals } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Die KI wird nicht aufgerufen: ausgeschaltet, außer im Test der Auslesung, der feste Werte bekommt
const ki = vi.hoisted(() => ({ available: false }));
vi.mock("../belege/extraction.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../belege/extraction.ts")>();
  return {
    ...original,
    extractionAvailable: () => ki.available,
    extractDocument: vi.fn(async () => ({
      extraction: { quelle: "test" },
      fields: {
        supplierName: "Telekom Deutschland GmbH",
        supplierUstId: "DE123475223",
        invoiceNumber: "MF-2026-09",
        documentDate: "2026-09-29",
        dueDate: null,
        currency: "EUR",
        category: "telefon" as const,
        amounts: [{ taxRate: 1900 as const, net: 3857, tax: 733 }],
        warnings: [],
      },
    })),
  };
});

/** Kleinste Datei, die Haben als JPEG erkennt; das letzte Byte macht jede Datei einzigartig (anderer SHA-256) */
const jpeg = (marker: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3, marker]);

describe.skipIf(!testDatabaseUrl)("REST-API /api/v1/belege (Postgres)", () => {
  let api: typeof import("./index.ts");
  let schemas: typeof import("./schemas.ts");
  let mcp: typeof import("../mcp/index.ts");
  let mcpServer: typeof import("../mcp/server.ts");
  let belege: typeof import("../belege/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    await sql`insert into "user"(id,name,email,role) values (${actor}, 'Testinhaber', 'inhaber@example.de', 'inhaber')`;
    api = await import("./index.ts");
    schemas = await import("./schemas.ts");
    mcp = await import("../mcp/index.ts");
    mcpServer = await import("../mcp/server.ts");
    belege = await import("../belege/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    ki.available = false;
    mcpServer.resetRateLimitForTests();
    await sql`truncate mcp_calls, mcp_tokens, journal_lines, journal_entries, document_amounts, documents, company cascade`;
    await sql`insert into company (id, name, kontenrahmen) values (1, 'Testfirma', 'SKR03')`;
  });

  type Scope = import("../mcp/index.ts").TokenScope;
  type Json = Record<string, unknown> & { error?: { code: string; message: string; existingId?: string } };

  async function token(scopes: Scope[]) {
    await mcp.setMcpEnabled(actor, true);
    return (await mcp.createMcpToken({ name: "Dokumentenarchiv", days: 30, scopes }, new Date(), actor)).token;
  }

  async function send(tokenValue: string | null, method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}) {
    const response = await api.handleApiRequest(
      new Request(`http://localhost:3000/api/v1${path}`, {
        method,
        headers: { ...(tokenValue ? { Authorization: `Bearer ${tokenValue}` } : {}), ...init.headers },
        body: init.body,
      }),
    );
    const text = await response.text();
    return { status: response.status, headers: response.headers, json: text ? (JSON.parse(text) as Json) : null };
  }

  /** Beleg als multipart/form-data wie mit curl -F datei=@rechnung.pdf */
  function upload(tokenValue: string, file: Uint8Array<ArrayBuffer> | null, fields: Record<string, string> = {}, filename = "beleg.jpg") {
    const form = new FormData();
    if (file) form.append("datei", new File([file], filename));
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    return send(tokenValue, "POST", "/belege", { body: form });
  }

  const count = async () => ((await sql`select count(*)::int as n from documents`) as unknown as [{ n: number }])[0].n;

  describe("Anmeldung und Rechte", () => {
    it("ohne Token 401; belege:lesen liest nur, belege:anlegen lädt hoch und liest; andere Rechte reichen nicht", async () => {
      expect((await send(null, "GET", "/belege")).status).toBe(401);
      const lesen = await token(["belege:lesen"]);
      const anlegen = await token(["belege:anlegen"]);
      const rechnungen = await token(["rechnungen:entwuerfe", "kontakte:schreiben"]);
      expect((await send(lesen, "GET", "/belege")).status).toBe(200);
      const forbidden = await upload(lesen, jpeg(1));
      expect(forbidden.status).toBe(403);
      expect(forbidden.json!.error!.message).toContain("belege:anlegen");
      expect((await send(rechnungen, "GET", "/belege")).status).toBe(403);
      expect((await upload(rechnungen, jpeg(1))).status).toBe(403);
      expect(await count()).toBe(0);
      expect((await upload(anlegen, jpeg(1))).status).toBe(201);
      expect((await send(anlegen, "GET", "/belege")).status).toBe(200);
    });
  });

  describe("Hochladen", () => {
    it("legt den Beleg als „Zu prüfen“ an, bucht nichts und protokolliert mit dem Token als Akteur", async () => {
      const t = await token(["belege:anlegen"]);
      const created = await upload(t, jpeg(2), { note: "Aus dem Archiv, Dokument 4711" }, "tankquittung.jpg");
      expect(created.status).toBe(201);
      const doc = schemas.documentSchema.parse(created.json);
      expect(doc).toMatchObject({
        filename: "tankquittung.jpg",
        mimeType: "image/jpeg",
        status: "neu",
        booked: false,
        bookedAt: null,
        extractionStatus: "keine",
        note: "Aus dem Archiv, Dokument 4711",
        gross: 0,
        externalSource: null,
        externalId: null,
        issues: expect.arrayContaining(["Lieferant fehlt", "Belegdatum fehlt"]),
      });
      expect(doc.url).toBe(`http://localhost:3000/belege/${doc.id}`);
      expect(created.headers.get("location")).toBe(`/api/v1/belege/${doc.id}`);
      expect((await sql`select count(*)::int as n from journal_entries`)[0]!.n).toBe(0);

      const [audit] = await sql`select actor from audit_log where table_name = 'documents' and action = 'INSERT' order by seq desc limit 1`;
      expect(audit!.actor).toBe(`api:${(await mcp.listMcpTokens())[0]!.id}:Dokumentenarchiv`);
      const calls = await mcp.recentMcpCalls();
      expect(calls.map((c) => [c.tool, c.ok])).toEqual([["POST /belege", true]]);
    });

    it("liest eine E-Rechnung sofort aus wie der Upload unter Belege", async () => {
      const t = await token(["belege:anlegen"]);
      const einvoice = await import("@haben/einvoice");
      const lines = [{ description: "Server CX22", quantity: 1000, unit: "Monat" as const, unitPrice: 3240, taxRate: 1900 as const }];
      const { pdf } = await einvoice.buildEInvoice({
        kind: "rechnung",
        format: "zugferd",
        number: "R0018834512",
        issueDate: "2026-09-30",
        dueDate: "2026-10-14",
        paymentTermDays: 14,
        currency: "EUR",
        seller: {
          name: "Hetzner Online GmbH",
          strasse: "Industriestr. 25",
          plz: "91710",
          ort: "Gunzenhausen",
          land: "DE",
          email: "info@hetzner.example",
          telefon: "+49 9831 5050",
          ustId: "DE812871812",
          iban: "DE92760700120750007700",
        },
        buyer: { name: "Testfirma", strasse: "Musterstraße 1", plz: "93047", ort: "Regensburg", land: "DE", email: "a@b.example" },
        lines: lines.map((l, i) => ({ ...l, position: i + 1, net: l.unitPrice })),
        totals: computeInvoiceTotals(lines),
      });
      const created = await upload(t, new Uint8Array(pdf), {}, "rechnung.pdf");
      expect(created.status).toBe(201);
      expect(schemas.documentSchema.parse(created.json)).toMatchObject({
        mimeType: "application/pdf",
        status: "neu",
        extractedBy: "zugferd",
        extractionStatus: "fertig",
        supplierName: "Hetzner Online GmbH",
        invoiceNumber: "R0018834512",
        documentDate: "2026-09-30",
        net: 3240,
        gross: 3856,
        amounts: [{ taxRate: 1900, net: 3240, tax: 616 }],
      });
    });

    it("startet die KI-Auslesung, wenn sie eingeschaltet ist; sie läuft nach der Antwort weiter", async () => {
      ki.available = true;
      const t = await token(["belege:anlegen"]);
      const created = await upload(t, jpeg(3));
      expect(created.status).toBe(201);
      const id = created.json!.id as string;
      expect(["laeuft", "fertig"]).toContain(created.json!.extractionStatus);
      await vi.waitFor(async () => expect((await send(t, "GET", `/belege/${id}`)).json!.extractionStatus).toBe("fertig"));
      expect((await send(t, "GET", `/belege/${id}`)).json).toMatchObject({ extractedBy: "ki", supplierName: "Telekom Deutschland GmbH", status: "neu" });
    });

    it("dieselbe externe Referenz liefert den vorhandenen Beleg mit 200, auch mit anderer Datei und gleichzeitig", async () => {
      const t = await token(["belege:anlegen"]);
      const ref = { externalSource: "archiv", externalId: "4711" };
      const first = await upload(t, jpeg(10), ref);
      expect(first.status).toBe(201);
      expect(first.json).toMatchObject(ref);
      const sameFile = await upload(t, jpeg(10), ref);
      expect(sameFile.status).toBe(200);
      expect(sameFile.json!.id).toBe(first.json!.id);
      const otherFile = await upload(t, jpeg(11), { ...ref, note: "anders" });
      expect(otherFile.status).toBe(200);
      expect(otherFile.json).toMatchObject({ id: first.json!.id, note: "" });
      expect(await count()).toBe(1);

      // Gleichzeitig, mit verschiedenen Dateien: der eindeutige Index lässt nur einen Beleg zu
      const parallel = await Promise.all([12, 13, 14].map((marker) => upload(t, jpeg(marker), { externalSource: "scanner", externalId: "A-1" })));
      expect(parallel.map((r) => r.status).sort()).toEqual([200, 200, 201]);
      expect(new Set(parallel.map((r) => r.json!.id)).size).toBe(1);
      // Gleichzeitig mit derselben Datei
      const sameParallel = await Promise.all([1, 2, 3].map(() => upload(t, jpeg(15), { externalSource: "scanner", externalId: "A-2" })));
      expect(sameParallel.map((r) => r.status).sort()).toEqual([200, 200, 201]);
      expect(new Set(sameParallel.map((r) => r.json!.id)).size).toBe(1);
      expect(await count()).toBe(3);

      // Dieselbe Kennung aus einer anderen Quelle ist ein anderer Beleg
      expect((await upload(t, jpeg(16), { externalSource: "mail", externalId: "4711" })).status).toBe(201);
      const half = await upload(t, jpeg(17), { externalSource: "archiv" });
      expect(half.status).toBe(400);
      expect(half.json!.error!.message).toMatch(/zusammen/);
      expect((await upload(t, jpeg(17), { externalSource: "Mein Archiv", externalId: "1" })).status).toBe(400);
    });

    it("dieselbe Datei: ohne Referenz 200 mit dem vorhandenen Beleg, mit anderer Referenz 409 mit Verweis darauf", async () => {
      const t = await token(["belege:anlegen"]);
      const first = await upload(t, jpeg(20), { externalSource: "archiv", externalId: "1" });
      expect(first.status).toBe(201);
      const plain = await upload(t, jpeg(20), {}, "nochmal.jpg");
      expect(plain.status).toBe(200);
      expect(plain.json).toMatchObject({ id: first.json!.id, filename: "beleg.jpg", externalId: "1" });

      const conflict = await upload(t, jpeg(20), { externalSource: "archiv", externalId: "2" });
      expect(conflict.status).toBe(409);
      expect(conflict.json!.error).toMatchObject({ code: "conflict", existingId: first.json!.id });
      expect(conflict.json!.error!.message).toMatch(/schon/);
      expect(conflict.headers.get("location")).toBe(`/api/v1/belege/${first.json!.id}`);

      // Von Hand hochgeladen (ohne Referenz), dann aus einem Werkzeug mit Referenz: ebenfalls 409, die Referenz bleibt frei
      const manual = await belege.uploadDocument(actor, { bytes: jpeg(21), filename: "hand.jpg" });
      const later = await upload(t, jpeg(21), { externalSource: "archiv", externalId: "3" });
      expect(later.status).toBe(409);
      expect(later.json!.error!.existingId).toBe(manual.id);
      expect((await upload(t, jpeg(22), { externalSource: "archiv", externalId: "3" })).status).toBe(201);
      expect(await count()).toBe(3);
    });

    it("lehnt falsches Format, zu große und leere Dateien, fehlende und unbekannte Felder ab", async () => {
      const t = await token(["belege:anlegen"]);
      const text = await upload(t, new TextEncoder().encode("kein Beleg"), {}, "notiz.txt");
      expect(text.status).toBe(415);
      expect(text.json!.error!.message).toMatch(/PDF, JPEG/);
      const big = new Uint8Array(belege.MAX_DOCUMENT_SIZE + 1);
      big.set(jpeg(30));
      const tooBig = await upload(t, big);
      expect(tooBig.status).toBe(413);
      expect(tooBig.json!.error!.message).toMatch(/20 MB/);
      // Der ganze Body über der Grenze: abgelehnt, bevor er ganz gelesen ist
      const huge = await upload(t, new Uint8Array(belege.MAX_DOCUMENT_SIZE + 2_000_000));
      expect(huge.status).toBe(413);
      expect(huge.json!.error).toMatchObject({ code: "payload_too_large" });

      const empty = await upload(t, new Uint8Array());
      expect(empty.status).toBe(400);
      const missing = await upload(t, null, { note: "ohne Datei" });
      expect(missing.status).toBe(400);
      expect(missing.json!.error).toMatchObject({ code: "validation_failed" });
      expect((missing.json!.error as unknown as { issues: { path: string }[] }).issues.map((i) => i.path)).toContain("datei");
      expect((await upload(t, jpeg(31), { supplierName: "Telekom" })).status).toBe(400);
      const json = await send(t, "POST", "/belege", { body: JSON.stringify({ datei: "x" }), headers: { "Content-Type": "application/json" } });
      expect(json.status).toBe(415);
      expect(json.json!.error!.message).toMatch(/multipart\/form-data/);
      const broken = await send(t, "POST", "/belege", { body: "kaputt", headers: { "Content-Type": "multipart/form-data; boundary=xyz" } });
      expect(broken.status).toBe(400);
      expect(await count()).toBe(0);
    });

    it("nimmt die Datei auch im Feld file an, wie die Webhook-Aktion von Paperless-ngx sie schickt (#104)", async () => {
      const t = await token(["belege:anlegen"]);
      const form = new FormData();
      form.append("file", new File([jpeg(50)], "paperless.jpg"));
      form.append("externalSource", "paperless");
      form.append("externalId", "4711");
      const created = await send(t, "POST", "/belege", { body: form });
      expect(created.status).toBe(201);
      expect(schemas.documentSchema.parse(created.json)).toMatchObject({ filename: "paperless.jpg", externalSource: "paperless", externalId: "4711" });
      // Ein doppelt ausgelöster Workflow legt nichts doppelt an
      const again = new FormData();
      again.append("file", new File([jpeg(50)], "paperless.jpg"));
      again.append("externalSource", "paperless");
      again.append("externalId", "4711");
      expect((await send(t, "POST", "/belege", { body: again })).status).toBe(200);
      expect(await count()).toBe(1);
    });

    it("lehnt eine Anfrage mit datei und file zugleich ab: eine Datei je Anfrage (#104)", async () => {
      const t = await token(["belege:anlegen"]);
      const form = new FormData();
      form.append("datei", new File([jpeg(51)], "a.jpg"));
      form.append("file", new File([jpeg(52)], "b.jpg"));
      const both = await send(t, "POST", "/belege", { body: form });
      expect(both.status).toBe(400);
      expect(both.json!.error).toMatchObject({ code: "validation_failed" });
      expect(both.json!.error!.message).toMatch(/datei oder file, nicht beide/);
      expect(await count()).toBe(0);
      // Ohne Datei nennt die Meldung beide Felder
      const missing = await upload(t, null, { note: "ohne Datei" });
      expect(missing.json!.error!.message).toMatch(/datei.*file|file.*datei/);
    });

    it("nennt bei einer leeren Datei im Feld file dieses Feld, nicht datei (#104)", async () => {
      const t = await token(["belege:anlegen"]);
      const form = new FormData();
      form.append("file", new File([new Uint8Array()], "leer.pdf"));
      const empty = await send(t, "POST", "/belege", { body: form });
      expect(empty.status).toBe(400);
      expect((empty.json!.error as unknown as { issues: { path: string }[] }).issues.map((i) => i.path)).toEqual(["file"]);
      expect(await count()).toBe(0);
    });
  });

  describe("Lesen", () => {
    it("listet mit Filter nach Status und Referenz; ein gebuchter Beleg zeigt gebucht und bleibt gesperrt", async () => {
      const t = await token(["belege:anlegen"]);
      const a = (await upload(t, jpeg(40), { externalSource: "archiv", externalId: "100" })).json!;
      await upload(t, jpeg(41), { externalSource: "archiv", externalId: "101" });
      await upload(t, jpeg(42));

      const byRef = schemas.documentListSchema.parse((await send(t, "GET", "/belege?externalSource=archiv&externalId=100")).json);
      expect(byRef).toMatchObject({ total: 1, limit: 100, offset: 0 });
      expect(byRef.data[0]).toMatchObject({ id: a.id, status: "neu", booked: false, externalId: "100" });
      expect(schemas.documentListSchema.parse((await send(t, "GET", "/belege?externalSource=archiv")).json).total).toBe(2);
      expect(schemas.documentListSchema.parse((await send(t, "GET", "/belege?limit=1&offset=1")).json)).toMatchObject({ total: 3 });
      expect((await send(t, "GET", "/belege?status=offen")).status).toBe(400);

      // Geprüft und gebucht wird in Haben
      await belege.updateDocument(actor, a.id as string, {
        supplierName: "Tankstelle Nord",
        supplierUstId: "",
        invoiceNumber: "T-1",
        documentDate: "2026-09-15",
        dueDate: null,
        category: "fahrtkosten",
        payment: "bank",
        note: "",
        amounts: [{ taxRate: 1900, net: 5000, tax: 950 }],
      });
      await belege.bookDocument(actor, a.id as string);
      const booked = await send(t, "GET", `/belege/${a.id}`);
      expect(booked.status).toBe(200);
      expect(schemas.documentSchema.parse(booked.json)).toMatchObject({ status: "gebucht", booked: true, gross: 5950, externalId: "100", issues: [] });
      expect(booked.json!.bookedAt).not.toBeNull();
      expect(schemas.documentListSchema.parse((await send(t, "GET", "/belege?status=gebucht")).json).data.map((d) => d.id)).toEqual([a.id]);
      expect(schemas.documentListSchema.parse((await send(t, "GET", "/belege?status=neu")).json).total).toBe(2);
      // Die Referenz eines gebuchten Belegs liefert weiter diesen Beleg
      expect((await upload(t, jpeg(43), { externalSource: "archiv", externalId: "100" })).json).toMatchObject({ id: a.id, status: "gebucht" });
      // Die Referenz steckt im Siegel und ist mit dem Beleg gesperrt
      const [seal] = await sql`select columns from seals where table_name = 'documents' and row_id = ${a.id as string}`;
      expect((seal!.columns as Record<string, string[]>).documents).toEqual(expect.arrayContaining(["external_source", "external_id"]));
      await expect(sql`update documents set external_id = '999' where id = ${a.id as string}`).rejects.toThrow();

      expect((await send(t, "GET", "/belege/00000000-0000-4000-8000-000000000000")).status).toBe(404);
      // Kein Löschen und Ändern über die API
      expect((await send(t, "DELETE", `/belege/${a.id}`)).status).toBe(405);
    });
  });
});
