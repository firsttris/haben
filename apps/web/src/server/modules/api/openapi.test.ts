import { beforeAll, describe, expect, it } from "vitest";

/** Alle Werte unter `key` irgendwo im Dokument */
function collect(value: unknown, key: string, found: unknown[] = []): unknown[] {
  if (Array.isArray(value)) for (const item of value) collect(item, key, found);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === key) found.push(v);
      collect(v, key, found);
    }
  }
  return found;
}

describe("OpenAPI-Beschreibung der REST-API", () => {
  let doc: ReturnType<typeof import("./openapi.ts").openApiDocument>;
  let routes: typeof import("./routes.ts").API_ROUTES;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://localhost/haben",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "x".repeat(32),
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "https://haben.example.de",
      HABEN_ENCRYPTION_KEY: process.env.HABEN_ENCRYPTION_KEY ?? Buffer.alloc(32).toString("base64"),
    });
    doc = (await import("./openapi.ts")).openApiDocument();
    routes = (await import("./routes.ts")).API_ROUTES;
  });

  it("ist OpenAPI 3.1 mit Bearer-Token und einem Recht je Endpunkt", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers).toEqual([{ url: "/api/v1" }]);
    expect(doc.components.securitySchemes.token).toMatchObject({ type: "http", scheme: "bearer" });
    for (const route of routes) {
      const op = (doc.paths[route.path] as Record<string, { security: unknown; operationId: string }>)[route.method.toLowerCase()]!;
      expect(op.security, `${route.method} ${route.path}`).toEqual([{ token: [route.scope] }]);
    }
    const ids = collect(doc.paths, "operationId");
    expect(new Set(ids).size).toBe(routes.length);
  });

  it("jeder Verweis zeigt auf ein Schema in components, keines bringt einen eigenen Dialekt mit", () => {
    const refs = collect(doc, "$ref") as string[];
    expect(refs.length).toBeGreaterThan(10);
    for (const ref of refs) {
      expect(ref).toMatch(/^#\/components\/schemas\//);
      expect(doc.components.schemas, ref).toHaveProperty(ref.split("/").pop()!);
    }
    expect(collect(doc.components, "$schema")).toEqual([]);
    expect(collect(doc.components, "$id")).toEqual([]);
  });

  it("beschreibt Artikelabruf, Anlage und Teiländerung mit den passenden Rechten", () => {
    expect(doc.paths["/artikel"]).toMatchObject({
      get: {
        security: [{ token: ["artikel:lesen"] }],
        responses: { 200: { content: { "application/json": { schema: { $ref: "#/components/schemas/ArticleList" } } } } },
      },
      post: {
        security: [{ token: ["artikel:schreiben"] }],
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/ArticleCreate" } } } },
        responses: { 422: { description: "Die Einheit ist in Haben nicht bekannt" } },
      },
    });
    expect(doc.paths["/artikel/{id}"]).toMatchObject({
      get: { security: [{ token: ["artikel:lesen"] }] },
      patch: {
        security: [{ token: ["artikel:schreiben"] }],
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/ArticlePatch" } } } },
        responses: { 422: { description: "Die Einheit ist in Haben nicht bekannt" } },
      },
    });
    expect(doc.components.schemas.ArticleCreate).toMatchObject({
      additionalProperties: false,
      required: ["description", "unit", "unitPrice", "taxRate"],
      properties: { unitPrice: { type: "integer", maximum: 2_147_483_647 } },
    });
    expect(doc.components.schemas.ArticlePatch).toMatchObject({ additionalProperties: false });
    expect(doc.components.schemas.ArticlePatch).not.toHaveProperty("required");
  });

  it("beschreibt Angebote nur zum Lesen, mit eigenem Recht und der Art jeder Position", () => {
    expect(Object.keys(doc.paths["/angebote"]!)).toEqual(["get"]);
    expect(Object.keys(doc.paths["/angebote/{id}"]!)).toEqual(["get"]);
    expect(doc.paths["/angebote"]).toMatchObject({
      get: {
        security: [{ token: ["angebote:lesen"] }],
        responses: { 200: { content: { "application/json": { schema: { $ref: "#/components/schemas/QuoteList" } } } } },
      },
    });
    expect(doc.paths["/angebote/{id}"]).toMatchObject({
      get: { responses: { 200: { content: { "application/json": { schema: { $ref: "#/components/schemas/Quote" } } } } } },
    });
    const lines = (doc.components.schemas.Quote as { properties: { lines: unknown } }).properties.lines;
    expect(JSON.stringify(lines)).toContain('"alternative"');
  });

  it("beschreibt Einheiten: Cent, Basispunkte, Tausendstel", () => {
    const line = doc.components.schemas.InvoiceLineInput as { properties: Record<string, { description?: string; type?: string }>; required: string[] };
    expect(line.properties.quantity!.description).toMatch(/Tausendsteln/);
    expect(line.properties.quantity!.type).toBe("integer");
    expect(line.properties.unitPrice!.description).toMatch(/Cent/);
    expect(line.properties.taxRate!.description).toMatch(/Basispunkten/);
    expect(line.required).toEqual(expect.arrayContaining(["description", "quantity", "unit", "unitPrice", "taxRate"]));
    // Seit den eigenen Einheiten (#748) ist die Einheit Text statt Aufzählung; die Beschreibung nennt, was geht
    expect(line.properties.unit!.description).toMatch(/Std\., Tag, Monat, Stk\., Psch\., km.*eigenen Einheit/);
    const invoice = doc.components.schemas.Invoice as { properties: Record<string, { description?: string }> };
    expect(invoice.properties.gross!.description).toMatch(/Cent/);
    expect(doc.info.description).toMatch(/Basispunkten/);
  });

  it("Eingaben sind streng: unbekannte Felder abgelehnt, die externe Referenz beschrieben", () => {
    const create = doc.components.schemas.InvoiceDraftCreate as { additionalProperties: boolean; required: string[]; properties: Record<string, unknown> };
    expect(create.additionalProperties).toBe(false);
    expect(create.required).toEqual(["lines"]);
    expect(create.properties).toHaveProperty("externalSource");
    expect(create.properties).not.toHaveProperty("variant");
    const patch = doc.components.schemas.InvoiceDraftPatch as { properties: Record<string, unknown> };
    expect(patch.properties).not.toHaveProperty("externalId");
    const contact = doc.components.schemas.ContactCreate as { required: string[] };
    expect(contact.required).toEqual(["name"]);
  });

  it("beschreibt den Beleg-Upload als multipart/form-data mit genau einer Datei", () => {
    const post = (doc.paths["/belege"] as Record<string, { requestBody: { content: Record<string, { schema: { $ref: string } }> }; responses: object }>).post!;
    expect(Object.keys(post.requestBody.content)).toEqual(["multipart/form-data"]);
    expect(post.requestBody.content["multipart/form-data"]!.schema.$ref).toBe("#/components/schemas/DocumentUpload");
    expect(Object.keys(post.responses)).toEqual(expect.arrayContaining(["200", "201", "409", "413", "415"]));
    const upload = doc.components.schemas.DocumentUpload as {
      additionalProperties: boolean;
      required?: string[];
      properties: Record<string, { type?: string; contentMediaType?: string; description?: string }>;
    };
    expect(upload.additionalProperties).toBe(false);
    // Die Datei in datei oder file (Paperless-ngx, #104), genau eines davon
    expect(upload.required ?? []).toEqual([]);
    expect(upload.properties.datei).toMatchObject({ type: "string", contentMediaType: "application/octet-stream" });
    expect(upload.properties.datei!.description).toMatch(/20 MB/);
    expect(upload.properties.file).toMatchObject({ type: "string", contentMediaType: "application/octet-stream" });
    expect(upload.properties.file!.description).toMatch(/Paperless/);
    const encoding = (post.requestBody.content["multipart/form-data"] as unknown as { encoding: Record<string, unknown> }).encoding;
    expect(Object.keys(encoding).sort()).toEqual(["datei", "file"]);
    expect(upload.properties).toHaveProperty("externalSource");
    expect(upload.properties).not.toHaveProperty("supplierName");
    const get = (doc.paths["/belege/{id}"] as Record<string, { security: unknown }>).get!;
    expect(get.security).toEqual([{ token: ["belege:lesen"] }]);
    expect(post).toMatchObject({ security: [{ token: ["belege:anlegen"] }] });
    const status = (doc.components.schemas.Document as { properties: Record<string, { enum?: string[]; description?: string }> }).properties.status!;
    expect(status.enum).toEqual(["neu", "gebucht"]);
    expect(status.description).toMatch(/Zu prüfen/);
  });

  it("Listen haben Query-Parameter mit Grenzen", () => {
    const list = (doc.paths["/rechnungen"] as { get: { parameters: { name: string; in: string; schema: Record<string, unknown> }[] } }).get;
    const names = list.parameters.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["status", "externalSource", "externalId", "limit", "offset"]));
    expect(list.parameters.find((p) => p.name === "limit")!.schema).toMatchObject({ type: "integer", minimum: 1, maximum: 500, default: 100 });
  });
});
