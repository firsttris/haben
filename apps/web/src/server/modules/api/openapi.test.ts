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

  it("beschreibt Einheiten: Cent, Basispunkte, Tausendstel", () => {
    const line = doc.components.schemas.InvoiceLineInput as { properties: Record<string, { description?: string; type?: string }>; required: string[] };
    expect(line.properties.quantity!.description).toMatch(/Tausendsteln/);
    expect(line.properties.quantity!.type).toBe("integer");
    expect(line.properties.unitPrice!.description).toMatch(/Cent/);
    expect(line.properties.taxRate!.description).toMatch(/Basispunkten/);
    expect(line.required).toEqual(expect.arrayContaining(["description", "quantity", "unit", "unitPrice", "taxRate"]));
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
      required: string[];
      properties: Record<string, { type?: string; contentMediaType?: string; description?: string }>;
    };
    expect(upload.additionalProperties).toBe(false);
    expect(upload.required).toEqual(["datei"]);
    expect(upload.properties.datei).toMatchObject({ type: "string", contentMediaType: "application/octet-stream" });
    expect(upload.properties.datei!.description).toMatch(/20 MB/);
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
