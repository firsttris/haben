import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("REST-API /api/v1 (Postgres)", () => {
  let api: typeof import("./index.ts");
  let schemas: typeof import("./schemas.ts");
  let mcp: typeof import("../mcp/index.ts");
  let mcpServer: typeof import("../mcp/server.ts");
  let rechnungen: typeof import("../rechnungen/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  const year = Number(today.slice(0, 4));

  beforeAll(async () => {
    sql = await setupTestDb();
    await sql`insert into "user"(id,name,email,role) values (${actor}, 'Testinhaber', 'inhaber@example.de', 'inhaber')`;
    api = await import("./index.ts");
    schemas = await import("./schemas.ts");
    mcp = await import("../mcp/index.ts");
    mcpServer = await import("../mcp/server.ts");
    rechnungen = await import("../rechnungen/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    mcpServer.resetRateLimitForTests();
    await leeren(sql)`truncate mcp_calls, mcp_tokens, journal_lines, journal_entries, invoice_lines, invoice_taxes, invoices, invoice_number_counters,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
  });

  type Scope = import("../mcp/index.ts").TokenScope;

  async function token(scopes: Scope[]) {
    await mcp.setMcpEnabled(actor, true);
    return (await mcp.createMcpToken({ name: "Shop-Automation", days: 30, scopes }, new Date(), actor)).token;
  }

  async function call(tokenValue: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await api.handleApiRequest(
      new Request(`http://localhost:3000/api/v1${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(tokenValue ? { Authorization: `Bearer ${tokenValue}` } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      json: text ? (JSON.parse(text) as Record<string, unknown> & { error?: { code: string; message: string } }) : null,
    };
  }

  const kunde = { name: "Etsy-Käuferin Anna Muster", strasse: "Lindenweg 3", plz: "10115", ort: "Berlin", email: "anna@example.com" };
  const draft = (extra: Record<string, unknown> = {}) => ({
    issueDate: `${year}-03-02`,
    lines: [{ description: "Keramikbecher handgemacht", quantity: 2000, unit: "Stk.", unitPrice: 2_400, taxRate: 1900 }],
    ...extra,
  });

  describe("Anmeldung und Rechte", () => {
    it("lehnt fehlende, falsche, widerrufene Tokens und ausgeschalteten Zugang mit 401 im JSON-Format ab", async () => {
      const t = await token(["kontakte:lesen"]);
      const missing = await call(null, "GET", "/kontakte");
      expect(missing.status).toBe(401);
      expect(missing.headers.get("www-authenticate")).toMatch(/^Bearer/);
      expect(missing.headers.get("content-type")).toMatch(/application\/json/);
      expect(missing.json!.error).toMatchObject({ code: "unauthorized" });
      expect(missing.json!.error!.message).toMatch(/API-Token/);
      expect((await call("hb_falsch", "GET", "/kontakte")).status).toBe(401);
      expect((await call(t, "GET", "/kontakte")).status).toBe(200);

      await mcp.setMcpEnabled(actor, false);
      expect((await call(t, "GET", "/kontakte")).status).toBe(401);
      await mcp.setMcpEnabled(actor, true);

      await mcp.revokeMcpToken(actor, (await mcp.listMcpTokens())[0]!.id);
      expect((await call(t, "GET", "/kontakte")).status).toBe(401);
    });

    it("prüft das Recht je Endpunkt; schreiben schließt lesen ein", async () => {
      const lesen = await token(["kontakte:lesen"]);
      const nurMcp = await token(["haben:lesen"]);
      const schreiben = await token(["kontakte:schreiben"]);
      const forbidden = await call(lesen, "POST", "/kontakte", kunde);
      expect(forbidden.status).toBe(403);
      expect(forbidden.json!.error).toMatchObject({ code: "forbidden" });
      expect(forbidden.json!.error!.message).toContain("kontakte:schreiben");
      expect((await call(nurMcp, "GET", "/kontakte")).status).toBe(403);
      expect((await call(lesen, "GET", "/rechnungen")).status).toBe(403);
      expect((await call(schreiben, "GET", "/kontakte")).status).toBe(200);
      expect((await call(schreiben, "POST", "/kontakte", kunde)).status).toBe(201);
    });

    it("protokolliert jeden Aufruf ohne Inhalte, mit dem Token im Audit-Log", async () => {
      const t = await token(["kontakte:schreiben"]);
      await call(t, "POST", "/kontakte", kunde);
      await call(t, "GET", "/kontakte/00000000-0000-4000-8000-000000000000");
      const calls = await mcp.recentMcpCalls();
      expect(calls.map((c) => [c.tool, c.ok])).toEqual([
        ["GET /kontakte/{id}", false],
        ["POST /kontakte", true],
      ]);
      const [audit] = await sql`select actor from audit_log where table_name = 'contacts' and action = 'INSERT' order by seq desc limit 1`;
      expect(audit!.actor).toBe(`api:${(await mcp.listMcpTokens())[0]!.id}:Shop-Automation`);
    });

    it("unterscheidet im Audit-Log zwei Tokens mit gleichem Namen und führt den Akteur auf sein Token zurück", async () => {
      const first = await token(["kontakte:schreiben"]);
      expect((await call(first, "POST", "/kontakte", kunde)).status).toBe(201);
      const [old] = await mcp.listMcpTokens();
      await mcp.revokeMcpToken(actor, old!.id);
      const second = await token(["kontakte:schreiben"]);
      expect((await call(second, "POST", "/kontakte", { ...kunde, name: "Etsy-Käufer Ben Beispiel" })).status).toBe(201);
      const renewed = (await mcp.listMcpTokens()).find((row) => row.id !== old!.id)!;
      expect(renewed.name).toBe(old!.name);

      const audit = await sql`select actor from audit_log where table_name = 'contacts' and action = 'INSERT' order by seq desc limit 2`;
      expect(audit.map((row) => row.actor)).toEqual([`api:${renewed.id}:Shop-Automation`, `api:${old!.id}:Shop-Automation`]);
      // Die ID im Akteur führt im selben Audit-Log zum Anlegen des Tokens und damit zum verantwortlichen Konto
      const created = await sql`select actor from audit_log where table_name = 'token_events' and new_value->>'token_id' = ${renewed.id}`;
      expect(created.map((row) => row.actor)).toEqual([actor]);
    });

    it("begrenzt die Anfragen je Token", async () => {
      const t = await token(["kontakte:lesen"]);
      const { tokenId } = (await mcp.listMcpTokens()).map((row) => ({ tokenId: row.id }))[0]!;
      for (let i = 0; i < 120; i++) mcp.rateLimited(tokenId);
      const limited = await call(t, "GET", "/kontakte");
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("60");
      expect(limited.json!.error).toMatchObject({ code: "rate_limited" });
    });
  });

  describe("Fehlerformat", () => {
    it("unbekannter Pfad 404, falsche Methode 405, kein JSON 400 bzw. 415, ungültige Eingabe 400 mit Feldern", async () => {
      const t = await token(["kontakte:schreiben"]);
      expect((await call(t, "GET", "/gibtsnicht")).json!.error).toMatchObject({ code: "not_found" });
      const wrong = await call(t, "DELETE", "/kontakte");
      expect(wrong.status).toBe(405);
      expect(wrong.headers.get("allow")).toBe("GET, POST");
      expect((await call(t, "POST", "/kontakte", "{kaputt", { "Content-Type": "application/json" })).json!.error).toMatchObject({ code: "invalid_json" });
      expect((await call(t, "POST", "/kontakte", "name=x", { "Content-Type": "application/x-www-form-urlencoded" })).status).toBe(415);
      const invalid = await call(t, "POST", "/kontakte", { name: "", land: "Deutschland" });
      expect(invalid.status).toBe(400);
      expect(invalid.json!.error).toMatchObject({ code: "validation_failed" });
      const issues = (invalid.json!.error as unknown as { issues: { path: string; message: string }[] }).issues;
      expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(["name", "land"]));
      expect(issues.find((i) => i.path === "land")!.message).toBe("Ländercode wie DE");
      expect((await call(t, "POST", "/kontakte", { ...kunde, unbekannt: 1 })).status).toBe(400);
      expect((await call(t, "GET", "/kontakte/keine-uuid")).status).toBe(404);
      expect((await call(t, "GET", "/kontakte?limit=0")).status).toBe(400);
    });
  });

  describe("Kontakte", () => {
    it("PATCH behält die Rollen und die Lieferantennummer eines Kontakts", async () => {
      const t = await token(["kontakte:schreiben"]);
      const stammdaten = await import("../stammdaten/index.ts");
      const lieferant = await stammdaten.createContact(actor, {
        ...schemas.CONTACT_DEFAULTS,
        name: "Großhandel Ton GmbH",
        isCustomer: false,
        isSupplier: true,
        lieferantennummer: "L-7",
      });
      const patched = await call(t, "PATCH", `/kontakte/${lieferant.id}`, { email: "einkauf@example.com" });
      expect(patched.status).toBe(200);
      const [row] = await sql`select is_customer, is_supplier, lieferantennummer, kundennummer from contacts where id = ${lieferant.id}`;
      expect(row).toMatchObject({ is_customer: false, is_supplier: true, lieferantennummer: "L-7", kundennummer: null });
    });

    it("liest und schreibt die Telefonnummer; PATCH ohne Telefon behält sie (#322)", async () => {
      const t = await token(["kontakte:schreiben"]);
      const created = await call(t, "POST", "/kontakte", { ...kunde, telefon: "+49 941 123456" });
      expect(created.status).toBe(201);
      const contact = schemas.contactSchema.parse(created.json);
      expect(contact.telefon).toBe("+49 941 123456");
      const patched = await call(t, "PATCH", `/kontakte/${contact.id}`, { email: "einkauf@example.com" });
      expect(schemas.contactSchema.parse(patched.json).telefon).toBe("+49 941 123456");
      const invalid = await call(t, "PATCH", `/kontakte/${contact.id}`, { telefon: "bitte anrufen" });
      expect(invalid.status).toBe(400);
    });

    it("legt an, liest, sucht und ändert; die Antwort passt zum Schema der OpenAPI-Beschreibung", async () => {
      const t = await token(["kontakte:schreiben"]);
      const created = await call(t, "POST", "/kontakte", kunde);
      expect(created.status).toBe(201);
      const contact = schemas.contactSchema.parse(created.json);
      expect(contact).toMatchObject({ name: kunde.name, land: "DE", version: 1, archived: false, ustId: "" });
      expect(created.headers.get("location")).toBe(`/api/v1/kontakte/${contact.id}`);
      expect(contact.url).toBe(`http://localhost:3000/kontakte/${contact.id}`);

      await call(t, "POST", "/kontakte", { name: "Zweiter Kunde GmbH", ort: "Hamburg" });
      const list = await call(t, "GET", "/kontakte?q=anna@");
      const page = schemas.contactListSchema.parse(list.json);
      expect(page).toMatchObject({ total: 1, limit: 100, offset: 0 });
      expect(page.data[0]!.id).toBe(contact.id);
      expect(schemas.contactListSchema.parse((await call(t, "GET", "/kontakte?limit=1&offset=1")).json)).toMatchObject({
        total: 2,
        data: [{ name: "Zweiter Kunde GmbH" }],
      });

      const patched = await call(t, "PATCH", `/kontakte/${contact.id}`, { ort: "Potsdam", plz: "14467" });
      expect(patched.status).toBe(200);
      expect(schemas.contactSchema.parse(patched.json)).toMatchObject({ name: kunde.name, ort: "Potsdam", plz: "14467", version: 2 });
      expect((await call(t, "GET", `/kontakte/${contact.id}`)).json).toMatchObject({ ort: "Potsdam" });
      expect((await call(t, "PATCH", "/kontakte/00000000-0000-4000-8000-000000000000", { ort: "x" })).status).toBe(404);
      expect((await call(t, "PATCH", `/kontakte/${contact.id}`, { ustId: "123" })).status).toBe(400);
    });
  });

  describe("Rechnungsentwürfe", () => {
    it("legt einen Entwurf mit Vorgaben aus den Firmendaten an; Beträge in Cent", async () => {
      const t = await token(["rechnungen:entwuerfe"]);
      const created = await call(t, "POST", "/rechnungen", draft());
      expect(created.status).toBe(201);
      const invoice = schemas.invoiceSchema.parse(created.json);
      expect(invoice).toMatchObject({
        status: "draft",
        listStatus: "entwurf",
        kind: "rechnung",
        number: null,
        paymentTermDays: 14,
        format: "zugferd",
        net: 4_800,
        tax: 912,
        gross: 5_712,
        externalSource: null,
        externalId: null,
      });
      expect(invoice.lines).toEqual([expect.objectContaining({ position: 1, quantity: 2000, unitPrice: 2_400, taxRate: 1900, net: 4_800 })]);
      expect(created.headers.get("location")).toBe(`/api/v1/rechnungen/${invoice.id}`);
    });

    it("liest und schreibt Bestell-, Auftrags- und Lieferscheinnummer; PATCH ohne sie behält sie (#389)", async () => {
      const t = await token(["rechnungen:entwuerfe"]);
      const refs = { buyerOrderReference: "4500012345", sellerOrderReference: "etsy-1001", despatchAdviceReference: "LS-0815" };
      const created = await call(t, "POST", "/rechnungen", draft(refs));
      expect(created.status).toBe(201);
      const invoice = schemas.invoiceSchema.parse(created.json);
      expect(invoice).toMatchObject(refs);
      const patched = await call(t, "PATCH", `/rechnungen/${invoice.id}`, { note: "Danke" });
      expect(schemas.invoiceSchema.parse(patched.json)).toMatchObject({ ...refs, note: "Danke" });
      const cleared = await call(t, "PATCH", `/rechnungen/${invoice.id}`, { despatchAdviceReference: "" });
      expect(cleared.json).toMatchObject({ despatchAdviceReference: "", buyerOrderReference: "4500012345" });
      expect((await call(t, "POST", "/rechnungen", draft({ buyerOrderReference: "x".repeat(101) }))).status).toBe(400);
    });

    it("liest und schreibt die Artikelnummer einer Position; PATCH ohne lines behält sie (#388)", async () => {
      const t = await token(["rechnungen:entwuerfe"]);
      const line = { description: "Dichtungssatz", itemNumber: "ET-1042", quantity: 3000, unit: "Stk.", unitPrice: 1_250, taxRate: 1900 };
      const created = await call(t, "POST", "/rechnungen", draft({ lines: [line] }));
      expect(created.status).toBe(201);
      const invoice = schemas.invoiceSchema.parse(created.json);
      expect(invoice.lines).toEqual([expect.objectContaining({ itemNumber: "ET-1042" })]);
      const patched = schemas.invoiceSchema.parse((await call(t, "PATCH", `/rechnungen/${invoice.id}`, { note: "Danke" })).json);
      expect(patched.lines).toEqual([expect.objectContaining({ itemNumber: "ET-1042" })]);
      const plain = schemas.invoiceSchema.parse((await call(t, "POST", "/rechnungen", draft())).json);
      expect(plain.lines).toEqual([expect.objectContaining({ itemNumber: "" })]);
    });

    it("nimmt Format und Sprache ohne Angabe vom Kontakt wie der Rechnungseditor", async () => {
      const t = await token(["rechnungen:entwuerfe", "kontakte:schreiben"]);
      const amt = (await call(t, "POST", "/kontakte", { name: "Stadt Regensburg", leitwegId: "09362000-12345-67", language: "en" })).json!;
      const created = await call(t, "POST", "/rechnungen", draft({ contactId: amt.id }));
      expect(created.status).toBe(201);
      expect(created.json).toMatchObject({ format: "xrechnung-cii", language: "en" });
      const explicit = await call(t, "POST", "/rechnungen", draft({ contactId: amt.id, format: "zugferd", language: "de" }));
      expect(explicit.json).toMatchObject({ format: "zugferd", language: "de" });
    });

    it("Skonto ohne Angabe aus den Firmendaten, passend zum Zahlungsziel; eigene Stufen und Fremdwährung", async () => {
      await sql`update company set skonto = ${JSON.stringify([
        { days: 10, percent: 200 },
        { days: 30, percent: 100 },
      ])}::jsonb`;
      try {
        const t = await token(["rechnungen:entwuerfe"]);
        const created = await call(t, "POST", "/rechnungen", draft());
        expect(schemas.invoiceSchema.parse(created.json).skonto).toEqual([{ days: 10, percent: 200 }]);
        expect((await call(t, "POST", "/rechnungen", draft({ paymentTermDays: 30 }))).json).toMatchObject({
          skonto: [
            { days: 10, percent: 200 },
            { days: 30, percent: 100 },
          ],
        });
        expect((await call(t, "POST", "/rechnungen", draft({ skonto: [] }))).json).toMatchObject({ skonto: [] });
        expect((await call(t, "POST", "/rechnungen", draft({ currency: "USD", exchangeRate: "1,08" }))).json).toMatchObject({ skonto: [] });
        expect((await call(t, "POST", "/rechnungen", draft({ skonto: [{ days: 20, percent: 200 }] }))).status).toBe(400);

        // PATCH ohne Skonto passt das Skonto des Entwurfs an wie die Vorgabe beim Anlegen, statt mit 400 abzulehnen:
        // Ein Client, der das Feld nicht kennt, ändert Zahlungsziel oder Währung wie vor dem Skonto
        const id = String((created.json as { id: string }).id);
        const shorter = await call(t, "PATCH", `/rechnungen/${id}`, { paymentTermDays: 7 });
        expect(shorter.status).toBe(200);
        expect(shorter.json).toMatchObject({ paymentTermDays: 7, skonto: [] });
        const longId = String(((await call(t, "POST", "/rechnungen", draft({ paymentTermDays: 30 }))).json as { id: string }).id);
        expect((await call(t, "PATCH", `/rechnungen/${longId}`, { paymentTermDays: 14 })).json).toMatchObject({ skonto: [{ days: 10, percent: 200 }] });
        const foreign = await call(t, "PATCH", `/rechnungen/${longId}`, { currency: "USD", exchangeRate: "1,08" });
        expect(foreign.status).toBe(200);
        expect(foreign.json).toMatchObject({ currency: "USD", skonto: [] });
        // Mit Angabe wird weiter geprüft
        expect((await call(t, "PATCH", `/rechnungen/${id}`, { skonto: [{ days: 10, percent: 200 }] })).status).toBe(400);
      } finally {
        await sql`update company set skonto = '[]'::jsonb`;
      }
    });

    it("dieselbe externe Referenz liefert den vorhandenen Entwurf mit 200 statt eines Duplikats, auch gleichzeitig", async () => {
      const t = await token(["rechnungen:entwuerfe"]);
      const ref = { externalSource: "etsy", externalId: "3141592653" };
      const first = await call(t, "POST", "/rechnungen", draft(ref));
      expect(first.status).toBe(201);
      expect(first.json).toMatchObject(ref);
      const again = await call(t, "POST", "/rechnungen", draft({ ...ref, note: "anders" }));
      expect(again.status).toBe(200);
      expect(again.json!.id).toBe(first.json!.id);
      expect(again.json!.note).toBe("");

      const parallel = await Promise.all([1, 2, 3].map(() => call(t, "POST", "/rechnungen", draft({ externalSource: "ebay", externalId: "12-34567-89012" }))));
      expect(parallel.map((r) => r.status).sort()).toEqual([200, 200, 201]);
      expect(new Set(parallel.map((r) => r.json!.id)).size).toBe(1);
      const [{ count }] = (await sql`select count(*)::int as count from invoices`) as unknown as [{ count: number }];
      expect(count).toBe(2);

      // Dieselbe Bestellnummer auf einer anderen Plattform ist ein anderer Vorgang
      expect((await call(t, "POST", "/rechnungen", draft({ externalSource: "ebay", externalId: "3141592653" }))).status).toBe(201);
      // Nur beide Felder zusammen
      const half = await call(t, "POST", "/rechnungen", draft({ externalSource: "etsy" }));
      expect(half.status).toBe(400);
      expect(half.json!.error!.message).toMatch(/zusammen/);
      expect((await call(t, "POST", "/rechnungen", draft({ externalSource: "Etsy Shop", externalId: "1" }))).status).toBe(400);
    });

    it("weist einen Kontakt ohne die Rolle Kunde ab, mit und ohne externe Referenz", async () => {
      const t = await token(["rechnungen:entwuerfe"]);
      const stammdaten = await import("../stammdaten/index.ts");
      const lieferant = await stammdaten.createContact(actor, {
        ...schemas.CONTACT_DEFAULTS,
        name: "Großhandel Ton GmbH",
        isCustomer: false,
        isSupplier: true,
      });
      for (const reference of [{}, { externalSource: "etsy", externalId: "7001" }]) {
        const result = await call(t, "POST", "/rechnungen", draft({ ...reference, contactId: lieferant.id }));
        expect(result.status).toBe(422);
        expect(result.json!.error!.message).toMatch(/Großhandel Ton GmbH“ ist kein Kunde/);
      }
      expect(await sql`select id from invoices where contact_id = ${lieferant.id}`).toHaveLength(0);
    });

    it("filtert nach Referenz, Status und Kontakt", async () => {
      const t = await token(["rechnungen:entwuerfe", "kontakte:schreiben"]);
      const contact = (await call(t, "POST", "/kontakte", kunde)).json!;
      await call(t, "POST", "/rechnungen", draft({ externalSource: "etsy", externalId: "1001", contactId: contact.id }));
      await call(t, "POST", "/rechnungen", draft({ externalSource: "etsy", externalId: "1002" }));
      await call(t, "POST", "/rechnungen", draft());
      const byRef = schemas.invoiceListSchema.parse((await call(t, "GET", "/rechnungen?externalSource=etsy&externalId=1002")).json);
      expect(byRef.total).toBe(1);
      expect(byRef.data[0]).toMatchObject({ externalSource: "etsy", externalId: "1002", listStatus: "entwurf" });
      expect(schemas.invoiceListSchema.parse((await call(t, "GET", "/rechnungen?externalSource=etsy")).json).total).toBe(2);
      expect(schemas.invoiceListSchema.parse((await call(t, "GET", `/rechnungen?contactId=${contact.id}`)).json).data[0]).toMatchObject({
        customer: kunde.name,
      });
      expect(schemas.invoiceListSchema.parse((await call(t, "GET", "/rechnungen?status=final")).json).total).toBe(0);
      expect((await call(t, "GET", "/rechnungen?status=offen")).status).toBe(400);
    });

    it("ändert und löscht Entwürfe; festgeschriebene Rechnungen lassen sich lesen, aber nicht ändern oder löschen", async () => {
      const t = await token(["rechnungen:entwuerfe", "kontakte:schreiben"]);
      const contact = (await call(t, "POST", "/kontakte", kunde)).json!;
      const created = (await call(t, "POST", "/rechnungen", draft({ contactId: contact.id, externalSource: "etsy", externalId: "777", issueDate: today })))
        .json!;
      const patched = await call(t, "PATCH", `/rechnungen/${created.id}`, {
        note: "Danke für deine Bestellung!",
        lines: [{ description: "Teller", quantity: 1000, unit: "Stk.", unitPrice: 3_000, taxRate: 1900 }],
      });
      expect(patched.status).toBe(200);
      expect(schemas.invoiceSchema.parse(patched.json)).toMatchObject({ note: "Danke für deine Bestellung!", net: 3_000, gross: 3_570, externalId: "777" });
      // Die Referenz gehört zum Vorgang und lässt sich nicht umhängen
      expect((await call(t, "PATCH", `/rechnungen/${created.id}`, { externalId: "778" })).status).toBe(400);

      // Festschreiben bleibt ein Klick in Haben
      const final = await rechnungen.finalizeInvoice(actor, created.id as string);
      const read = await call(t, "GET", `/rechnungen/${created.id}`);
      expect(read.status).toBe(200);
      expect(schemas.invoiceSchema.parse(read.json)).toMatchObject({
        status: "final",
        number: final.number,
        listStatus: "offen",
        open: 3_570,
        externalId: "777",
      });
      const locked = await call(t, "PATCH", `/rechnungen/${created.id}`, { note: "geändert" });
      expect(locked.status).toBe(409);
      expect(locked.json!.error).toMatchObject({ code: "conflict" });
      expect(locked.json!.error!.message).toMatch(/festgeschrieben/);
      expect((await call(t, "DELETE", `/rechnungen/${created.id}`)).status).toBe(409);
      // Die Referenz einer festgeschriebenen Rechnung liefert weiter diese Rechnung, kein neuer Entwurf
      const again = await call(t, "POST", "/rechnungen", draft({ externalSource: "etsy", externalId: "777" }));
      expect(again.status).toBe(200);
      expect(again.json).toMatchObject({ id: created.id, status: "final" });
      // Die Referenz steckt im Siegel der festgeschriebenen Rechnung
      const [seal] = await sql`select columns from seals where table_name = 'invoices' and row_id = ${created.id as string}`;
      expect((seal!.columns as Record<string, string[]>).invoices).toEqual(expect.arrayContaining(["external_source", "external_id"]));

      const other = (await call(t, "POST", "/rechnungen", draft())).json!;
      const deleted = await call(t, "DELETE", `/rechnungen/${other.id}`);
      expect(deleted.status).toBe(204);
      expect(deleted.json).toBeNull();
      expect((await call(t, "GET", `/rechnungen/${other.id}`)).status).toBe(404);
    });

    it("lehnt unbekannte Kontakte, Felder der Oberfläche und ungültige Positionen ab", async () => {
      const t = await token(["rechnungen:entwuerfe"]);
      const unknown = await call(t, "POST", "/rechnungen", draft({ contactId: "00000000-0000-4000-8000-000000000000" }));
      expect(unknown.status).toBe(422);
      expect(unknown.json!.error!.message).toMatch(/Kontakt/);
      expect((await call(t, "POST", "/rechnungen", draft({ variant: "schluss" }))).status).toBe(400);
      expect((await call(t, "POST", "/rechnungen", draft({ lines: [] }))).status).toBe(400);
      const badLine = await call(t, "POST", "/rechnungen", draft({ lines: [{ description: "x", quantity: 1.5, unit: "Stk.", unitPrice: 100, taxRate: 19 }] }));
      expect(badLine.status).toBe(400);
      expect((badLine.json!.error as unknown as { issues: { path: string }[] }).issues.map((i) => i.path)).toEqual(
        expect.arrayContaining(["lines.0.quantity", "lines.0.taxRate"]),
      );
      // Auch die Meldungen von Zod selbst auf Deutsch
      expect(badLine.json!.error!.message).toContain("lines.0.taxRate: Ungültige Option: erwartet eine von 1900|700|0");
    });

    it("liest nur mit rechnungen:lesen und schreibt nichts", async () => {
      const lesen = await token(["rechnungen:lesen"]);
      expect((await call(lesen, "GET", "/rechnungen")).status).toBe(200);
      expect((await call(lesen, "POST", "/rechnungen", draft())).status).toBe(403);
    });
  });

  describe("OpenAPI", () => {
    it("liefert die Beschreibung ohne Token, mit allen Endpunkten und Rechten", async () => {
      const response = await call(null, "GET", "/openapi.json");
      expect(response.status).toBe(200);
      const doc = response.json as { openapi: string; paths: Record<string, Record<string, { security: { token: string[] }[] }>> };
      expect(doc.openapi).toBe("3.1.0");
      expect(Object.keys(doc.paths).sort()).toEqual(["/belege", "/belege/{id}", "/kontakte", "/kontakte/{id}", "/rechnungen", "/rechnungen/{id}"]);
      expect(doc.paths["/rechnungen"]!.post!.security).toEqual([{ token: ["rechnungen:entwuerfe"] }]);
    });
  });
});
