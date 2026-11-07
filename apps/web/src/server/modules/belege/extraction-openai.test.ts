import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExtractionConfig } from "./extraction-config.ts";
import { extractWithOpenAiCompatible, parseExtraction } from "./extraction-openai.ts";
import type { Extraction } from "./extraction-schema.ts";
import type { PdfToImages } from "./pdf-pages.ts";
import { completion, startTestService, unusedPort, type TestService } from "./test-ki-dienst.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const ANSWER: Extraction = {
  lieferant: "Hetzner Online GmbH",
  lieferantUstId: "DE812871812",
  empfaenger: null,
  empfaengerUstId: null,
  rechnungsnummer: "R0018834512",
  belegdatum: "2026-09-30",
  faelligAm: null,
  waehrung: "EUR",
  istGutschrift: false,
  betraege: [{ steuersatz: "19", netto: "32.40", steuer: "6.16" }],
  brutto: "38.56",
  kategorie: "edv",
  hinweis: null,
};

type OpenAiConfig = Extract<ExtractionConfig, { provider: "openai-compatible" }>;

const noPdf: PdfToImages = vi.fn(async () => {
  throw new Error("kein PDF erwartet");
});

describe("OpenAI-kompatibler Dienst", () => {
  let service: TestService;
  let config: OpenAiConfig;

  beforeAll(async () => {
    service = await startTestService(() => ({ body: completion(JSON.stringify(ANSWER)) }));
    config = {
      provider: "openai-compatible",
      model: "qwen2.5vl:7b",
      endpoint: `${service.baseUrl}/chat/completions`,
      apiKey: null,
      timeoutMs: 5_000,
      maxPages: 2,
    };
  });

  afterEach(() => {
    service.requests.length = 0;
    service.reply(() => ({ body: completion(JSON.stringify(ANSWER)) }));
  });

  afterAll(async () => {
    await service.close();
  });

  const extract = (overrides: Partial<OpenAiConfig> = {}, bytes = JPEG, kind: "jpeg" | "pdf" | "heic" = "jpeg", pdfToImages = noPdf) =>
    extractWithOpenAiCompatible({ ...config, ...overrides }, bytes, kind, { fetch, pdfToImages });

  it("schickt das Foto als Bild mit JSON-Schema und liest die Antwort nach dem gemeinsamen Schema", async () => {
    const result = await extract();
    expect(result).toEqual({ extraction: ANSWER, warnings: [] });
    const [request] = service.requests;
    expect(request!.path).toBe("/v1/chat/completions");
    expect(request!.headers.authorization).toBeUndefined();
    const body = request!.body as {
      model: string;
      messages: { role: string; content: unknown }[];
      response_format: { type: string; json_schema: { schema: { required: string[] } } };
    };
    expect(body.model).toBe("qwen2.5vl:7b");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.schema.required).toContain("betraege");
    const user = body.messages.find((m) => m.role === "user")!.content as { type: string; image_url?: { url: string } }[];
    expect(user.filter((part) => part.type === "image_url").map((part) => part.image_url!.url)).toEqual([
      `data:image/jpeg;base64,${Buffer.from(JPEG).toString("base64")}`,
    ]);
  });

  it("sendet den Schlüssel nur, wenn einer gesetzt ist, als Bearer", async () => {
    await extract({ apiKey: "geheim-123" });
    expect(service.requests[0]!.headers.authorization).toBe("Bearer geheim-123");
  });

  it("PDF: wandelt in Seitenbilder um und meldet, wenn Seiten fehlen", async () => {
    const pages = [new Uint8Array([1]), new Uint8Array([2])];
    const pdfToImages = vi.fn(async () => ({ pages, truncated: true }));
    const result = await extract({}, new Uint8Array([0x25, 0x50, 0x44, 0x46]), "pdf", pdfToImages);
    expect(pdfToImages).toHaveBeenCalledWith(expect.any(Uint8Array), 2);
    expect(result.warnings).toEqual(["Das PDF hat mehr als 2 Seiten; ausgelesen wurden nur die ersten 2."]);
    const user = (service.requests[0]!.body.messages as { role: string; content: { type: string; image_url?: { url: string } }[] }[])[1]!.content;
    expect(user.filter((part) => part.type === "image_url").map((part) => part.image_url!.url)).toEqual([
      "data:image/png;base64,AQ==",
      "data:image/png;base64,Ag==",
    ]);
  });

  it("nicht unterstützte Formate gehen gar nicht erst an den Dienst", async () => {
    await expect(extract({}, JPEG, "heic")).rejects.toThrow(/Dateiformat kann die KI nicht lesen/);
    expect(service.requests).toHaveLength(0);
  });

  it("kann der Dienst kein JSON-Schema, fragt Haben denselben Dienst ohne und prüft selbst", async () => {
    service.reply((_request, index) =>
      index === 0
        ? { status: 400, body: { error: { message: "response_format json_schema is not supported" } } }
        : { body: completion(`<think>…</think>Hier das Ergebnis:\n\`\`\`json\n${JSON.stringify({ ...ANSWER, brutto: 38.56 })}\n\`\`\``) },
    );
    const result = await extract();
    expect(result.extraction).toEqual(ANSWER);
    expect(service.requests).toHaveLength(2);
    expect(service.requests[1]!.body.response_format).toBeUndefined();
  });

  it("falsches JSON oder fremdes Schema: verständlicher Fehler, keine Felder", async () => {
    service.reply(() => ({ body: completion("Ich kann den Beleg nicht lesen.") }));
    await expect(extract()).rejects.toThrow(/passt nicht zum Belegschema/);
    service.reply(() => ({ body: completion(JSON.stringify({ ...ANSWER, kategorie: "erfunden" })) }));
    await expect(extract()).rejects.toThrow(/passt nicht zum Belegschema/);
    service.reply(() => ({ body: "<html>kein JSON</html>" }));
    await expect(extract()).rejects.toThrow(/passt nicht zum Belegschema/);
  });

  it("abgeschnittene Antwort gilt als unvollständig", async () => {
    service.reply(() => ({ body: completion('{"lieferant": "Hetz', "length") }));
    await expect(extract()).rejects.toThrow(/unvollständig/);
  });

  it("Zeitüberschreitung", async () => {
    service.reply(() => "nie");
    await expect(extract({ timeoutMs: 200 })).rejects.toMatchObject({
      reason: "zeitueberschreitung",
      message: expect.stringMatching(/nicht innerhalb von 0.2 Sekunden/),
    });
  });

  it("nicht erreichbar: Meldung mit Adresse, ohne Schlüssel", async () => {
    const port = await unusedPort();
    const error = await extract({ endpoint: `http://nutzer:passwort@127.0.0.1:${port}/v1/chat/completions?key=x`, apiKey: "geheim-123" }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ reason: "nicht-erreichbar" });
    const message = (error as Error).message;
    expect(message).toContain(`http://127.0.0.1:${port}/v1/chat/completions`);
    expect(message).not.toMatch(/passwort|geheim|key=/);
  });

  it("HTTP-Fehler werden verständlich gemeldet", async () => {
    service.reply(() => ({ status: 401, body: { error: { message: "invalid api key" } } }));
    await expect(extract({ apiKey: "falsch" })).rejects.toThrow(/Schlüssel abgelehnt/);
    service.reply(() => ({ status: 404, body: { error: { message: 'model "qwen" not found' } } }));
    await expect(extract()).rejects.toThrow(/kennt das Modell „qwen2.5vl:7b“/);
    service.reply(() => ({ status: 400, body: { error: { message: "this model does not support images" } } }));
    await expect(extract()).rejects.toThrow(/Vision-Modell.*does not support images/);
    service.reply(() => ({ status: 500, body: "kaputt" }));
    await expect(extract()).rejects.toThrow(/HTTP 500/);
  });
});

describe("Umleitungen des Dienstes", () => {
  it("folgt keiner Umleitung: Beleg und Schlüssel gehen nur an die eingerichtete Adresse", async () => {
    const received: { authorization?: string; bytes: number }[] = [];
    const other = createServer((req, res) => {
      let bytes = 0;
      req.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
      });
      req.on("end", () => {
        received.push({ authorization: req.headers.authorization, bytes });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(completion(JSON.stringify(ANSWER))));
      });
    });
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    const otherPort = (other.address() as AddressInfo).port;
    // Anderer Host als der eingerichtete (localhost statt 127.0.0.1), 307 behält POST und Inhalt
    const original = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(307, { location: `http://localhost:${otherPort}/v1/chat/completions` });
        res.end();
      });
    });
    await new Promise<void>((resolve) => original.listen(0, "127.0.0.1", resolve));
    const port = (original.address() as AddressInfo).port;
    try {
      const config: OpenAiConfig = {
        provider: "openai-compatible",
        model: "qwen2.5vl:7b",
        endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
        apiKey: "geheim-123",
        timeoutMs: 5_000,
        maxPages: 2,
      };
      const error = await extractWithOpenAiCompatible(config, JPEG, "jpeg", { fetch, pdfToImages: noPdf }).catch((e: unknown) => e);
      expect(received).toEqual([]);
      expect(error).toMatchObject({ reason: "umleitung" });
      expect((error as Error).message).not.toContain("geheim");
    } finally {
      original.closeAllConnections();
      other.closeAllConnections();
      await new Promise<void>((resolve) => original.close(() => resolve()));
      await new Promise<void>((resolve) => other.close(() => resolve()));
    }
  });
});

describe("Meldungen des Dienstes", () => {
  let service: TestService;
  beforeAll(async () => {
    service = await startTestService(() => ({ status: 500, body: { error: { message: "upstream rejected Authorization: Bearer geheim-123" } } }));
  });
  afterAll(async () => {
    await service.close();
  });

  it("gibt den Schlüssel nie in der Meldung am Beleg wieder, auch wenn der Dienst ihn zurückschreibt", async () => {
    const config: OpenAiConfig = {
      provider: "openai-compatible",
      model: "qwen2.5vl:7b",
      endpoint: `${service.baseUrl}/chat/completions`,
      apiKey: "geheim-123",
      timeoutMs: 5_000,
      maxPages: 2,
    };
    for (const status of [400, 500]) {
      service.reply(() => ({ status, body: { error: { message: "upstream rejected Authorization: Bearer geheim-123" } } }));
      const error = await extractWithOpenAiCompatible(config, JPEG, "jpeg", { fetch, pdfToImages: noPdf }).catch((e: unknown) => e);
      expect((error as Error).message).toMatch(new RegExp(`HTTP ${status}`));
      expect((error as Error).message).not.toContain("geheim-123");
    }
  });
});

describe("Antwort ohne strukturierte Ausgabe lesen", () => {
  it("nimmt Zahlen als Dezimaltext an", () => {
    const parsed = parseExtraction(JSON.stringify({ ...ANSWER, betraege: [{ steuersatz: 19, netto: 32.4, steuer: 6.16 }], brutto: 38.56 }));
    expect(parsed.betraege).toEqual([{ steuersatz: "19", netto: "32.4", steuer: "6.16" }]);
    expect(parsed.brutto).toBe("38.56");
  });

  it("lehnt einen unbekannten Steuersatz ab", () => {
    expect(() => parseExtraction(JSON.stringify({ ...ANSWER, betraege: [{ steuersatz: 16, netto: "1", steuer: "0.16" }] }))).toThrow(/Belegschema/);
  });

  // Zweites TDD-Review PR #363: Eine Antwort, die vor der Erkennung eigener Rechnungen gültig war, bleibt gültig
  it("nimmt eine Antwort ohne die Felder zum Rechnungsempfänger an", () => {
    const { empfaenger: _name, empfaengerUstId: _ustId, ...withoutRecipient } = ANSWER;
    const parsed = parseExtraction(JSON.stringify(withoutRecipient));
    expect(parsed).toEqual({ ...ANSWER, empfaenger: null, empfaengerUstId: null });
  });
});
