import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LexofficeApiError, LexofficeClient, LexofficeSchemaError, parseContentDispositionFilename } from "./client.ts";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../test-fixtures/lexoffice/${name}`, import.meta.url), "utf8"));

interface Call {
  url: URL;
  headers: Record<string, string>;
}

type Handler = (url: URL, headers: Record<string, string>) => Response | Promise<Response>;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function setup(handler: Handler, opts: { minIntervalMs?: number; maxRetries?: number } = {}) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let clock = 1_000_000;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url, headers });
    return handler(url, headers);
  }) as typeof fetch;
  const client = new LexofficeClient({
    apiKey: "test-key",
    fetch: fetchFn,
    minIntervalMs: opts.minIntervalMs ?? 0,
    maxRetries: opts.maxRetries,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  });
  return {
    client,
    calls,
    sleeps,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

function listItem(id: string, archived = false) {
  return {
    id,
    voucherType: "invoice",
    voucherStatus: "paid",
    voucherNumber: `RE-${id}`,
    voucherDate: "2023-02-21T00:00:00.000+01:00",
    createdDate: "2023-02-21T14:43:28.000+01:00",
    updatedDate: "2023-02-21T14:45:01.000+01:00",
    dueDate: null,
    contactName: "Berliner Kindl GmbH",
    totalAmount: 119,
    openAmount: 0,
    currency: "EUR",
    archived,
  };
}

function page(content: unknown[], number: number, totalPages: number) {
  return {
    content,
    first: number === 0,
    last: number === totalPages - 1,
    totalPages,
    totalElements: 999,
    number,
    size: 250,
    numberOfElements: content.length,
  };
}

describe("LexofficeClient – Grundlagen", () => {
  it("sendet Bearer-Token und Accept an die Standard-Basis-URL", async () => {
    const { client, calls } = setup(() => json(fixture("profile.json")));
    const p = await client.profile();
    expect(p.companyName).toBe("Testfirma Teufel");
    expect(p.smallBusiness).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.href).toBe("https://api.lexware.io/v1/profile");
    expect(calls[0]!.headers.authorization).toBe("Bearer test-key");
    expect(calls[0]!.headers.accept).toBe("application/json");
  });

  it("verwendet eine konfigurierte Basis-URL", async () => {
    const calls: string[] = [];
    const client = new LexofficeClient({
      apiKey: "k",
      baseUrl: "https://api.lexoffice.io/v1/",
      minIntervalMs: 0,
      fetch: (async (u: RequestInfo | URL) => {
        calls.push(String(u));
        return json([{ id: "c1", name: "Erlöse", type: "income", contactRequired: false, splitAllowed: true, groupName: "Einnahmen" }]);
      }) as typeof fetch,
    });
    const cats = await client.postingCategories();
    expect(cats[0]!.type).toBe("income");
    expect(calls).toEqual(["https://api.lexoffice.io/v1/posting-categories"]);
  });

  it("liefert das vollständige Roh-JSON (unbekannte Felder bleiben erhalten)", async () => {
    const raw = fixture("invoice-two-rates.json");
    const { client } = setup(() => json(raw));
    const doc = await client.salesDocument("invoice", "e9066f04-8cc7-4616-93f8-ac9ecc8479c8");
    expect(doc).toEqual(raw);
    expect(doc.recurringTemplateId).toBeNull();
  });
});

describe("Paging", () => {
  it("liest 3 Seiten je archiviert/nicht archiviert und dedupliziert nach id", async () => {
    const { client, calls } = setup((url) => {
      const p = Number(url.searchParams.get("page"));
      if (url.searchParams.get("archived") === "false") {
        return json(page([[listItem("a"), listItem("b")], [listItem("c")], [listItem("d")]][p]!, p, 3));
      }
      // "d" taucht – z. B. weil währenddessen archiviert – auch hier auf
      return json(page([[listItem("d", true)], [listItem("e", true)], [listItem("f", true)]][p]!, p, 3));
    });
    const items = await collect(client.voucherList(["invoice", "creditnote", "invoice"]));
    expect(items.map((i) => i.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(calls).toHaveLength(6);
    const first = calls[0]!.url;
    expect(first.pathname).toBe("/v1/voucherlist");
    expect(first.searchParams.get("voucherType")).toBe("invoice,creditnote");
    expect(first.searchParams.get("voucherStatus")).toBe("any");
    expect(first.searchParams.get("size")).toBe("250");
    expect(calls.map((c) => `${c.url.searchParams.get("archived")}:${c.url.searchParams.get("page")}`)).toEqual([
      "false:0",
      "false:1",
      "false:2",
      "true:0",
      "true:1",
      "true:2",
    ]);
  });

  it("hört bei leerer Seite auf, auch ohne last/totalPages", async () => {
    const { client, calls } = setup((url) => {
      const p = Number(url.searchParams.get("page"));
      return json({ content: p === 0 ? Array.from({ length: 100 }, (_, i) => ({ id: `c${i}` })) : [] });
    });
    const contacts = await collect(client.contacts());
    expect(contacts).toHaveLength(100);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.searchParams.get("size")).toBe("100");
  });
});

describe("Fehlerbehandlung", () => {
  it("wartet bei 429 die Retry-After-Zeit ab und versucht erneut", async () => {
    let n = 0;
    const { client, sleeps, calls } = setup(() =>
      ++n === 1 ? new Response("too many", { status: 429, headers: { "retry-after": "2" } }) : json(fixture("profile.json")),
    );
    await client.profile();
    expect(calls).toHaveLength(2);
    expect(sleeps).toContain(2000);
  });

  it("nutzt exponentielles Backoff bei 503 ohne Retry-After und gibt nach maxRetries auf", async () => {
    const { client, sleeps, calls } = setup(() => new Response("", { status: 503 }), { maxRetries: 3 });
    const err = await client.profile().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LexofficeApiError);
    expect((err as LexofficeApiError).status).toBe(503);
    expect(calls).toHaveLength(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it("wiederholt bei Netzwerkfehlern", async () => {
    let n = 0;
    const { client } = setup(() => {
      if (++n === 1) throw new TypeError("fetch failed");
      return json(fixture("profile.json"));
    });
    await expect(client.profile()).resolves.toMatchObject({ companyName: "Testfirma Teufel" });
  });

  it("401 → deutsche Meldung zum API-Schlüssel", async () => {
    const { client, calls } = setup(() => json({ message: "Unauthorized" }, 401));
    await expect(client.profile()).rejects.toThrow("API-Schlüssel ungültig oder abgelaufen");
    expect(calls).toHaveLength(1);
  });

  it("403 → Hinweis auf Tarif XL", async () => {
    const { client } = setup(() => json({ message: "Forbidden" }, 403));
    const err = (await client.profile().catch((e: unknown) => e)) as LexofficeApiError;
    expect(err.status).toBe(403);
    expect(err.path).toBe("/profile");
    expect(err.message).toMatch(/Kein Zugriff.*Tarif XL/);
  });

  it("andere Fehler enthalten Status, Pfad und Fehlertext der API", async () => {
    const { client } = setup(() =>
      json({ IssueList: [{ i18nKey: "missing_entity", source: "id", type: "validation_failure" }] }, 400),
    );
    await expect(client.voucher("v1")).rejects.toThrow("Lexware-API-Fehler 400 bei GET /vouchers/v1 – id: missing_entity");
  });

  it("Schemafehler nennen Pfad und Feld auf Deutsch", async () => {
    const bad = { ...(fixture("voucher-gross.json") as object), voucherItems: [{ amount: "119,00", categoryId: "x" }] };
    const { client } = setup(() => json(bad));
    const err = (await client.voucher("a8a5").catch((e: unknown) => e)) as LexofficeSchemaError;
    expect(err).toBeInstanceOf(LexofficeSchemaError);
    expect(err).toBeInstanceOf(LexofficeApiError);
    expect(err.path).toBe("/vouchers/a8a5");
    expect(err.message).toBe("Unerwartete Antwort von GET /vouchers/a8a5: Feld „voucherItems.0.amount“: erwartet Zahl");
  });

  it("payments: 404 → null", async () => {
    const { client } = setup(() => json({ message: "not found" }, 404));
    await expect(client.payments("x")).resolves.toBeNull();
  });

  it("bricht über das AbortSignal ab", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const client = new LexofficeClient({ apiKey: "k", signal: ctrl.signal, fetch: (async () => json({})) as typeof fetch });
    await expect(client.profile()).rejects.toThrow("Import abgebrochen");
  });
});

describe("Drosselung", () => {
  it("hält mindestens minIntervalMs zwischen Request-Starts ein", async () => {
    const { client, sleeps, advance } = setup(() => json(fixture("profile.json")), { minIntervalMs: 600 });
    await client.profile(); // erster Request: keine Wartezeit
    expect(sleeps).toEqual([]);
    await client.profile(); // sofort danach: volle 600 ms
    advance(250);
    await client.profile(); // 250 ms vergangen: noch 350 ms
    advance(1000);
    await client.profile(); // lange her: keine Wartezeit
    expect(sleeps).toEqual([600, 350]);
  });

  it("serialisiert parallele Aufrufe", async () => {
    const { client, sleeps } = setup(() => json(fixture("profile.json")), { minIntervalMs: 600 });
    await Promise.all([client.profile(), client.profile(), client.profile()]);
    expect(sleeps).toEqual([600, 600]);
  });
});

describe("Dateien", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

  it("Rechnungs-PDF über /file", async () => {
    const { client, calls } = setup(
      () => new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="RE1019.pdf"' } }),
    );
    const f = await client.salesDocumentPdf("creditnote", "cn1");
    expect(f).toEqual({ bytes: pdf, mimeType: "application/pdf", filename: "RE1019.pdf" });
    expect(calls[0]!.url.pathname).toBe("/v1/credit-notes/cn1/file");
    expect(calls[0]!.headers.accept).toBe("application/pdf");
  });

  it("/file 404 → /document + /files/{id}", async () => {
    const { client, calls } = setup((url) => {
      if (url.pathname.endsWith("/file")) return json({ message: "Not Found" }, 404);
      if (url.pathname.endsWith("/document")) return json({ documentFileId: "doc-1" });
      return new Response(pdf, { headers: { "content-type": "application/pdf; charset=binary" } });
    });
    const f = await client.salesDocumentPdf("invoice", "inv1");
    expect(f).toEqual({ bytes: pdf, mimeType: "application/pdf", filename: null });
    expect(calls.map((c) => c.url.pathname)).toEqual([
      "/v1/invoices/inv1/file",
      "/v1/invoices/inv1/document",
      "/v1/files/doc-1",
    ]);
  });

  it("kein PDF vorhanden → null", async () => {
    const { client } = setup(() => json({ message: "Not Found" }, 404));
    await expect(client.salesDocumentPdf("downpaymentinvoice", "d1")).resolves.toBeNull();
  });

  it("E-Rechnungs-XML: 406 → null, sonst Datei", async () => {
    const none = setup(() => json({ message: "Not Acceptable" }, 406));
    await expect(none.client.salesDocumentXml("invoice", "i1")).resolves.toBeNull();
    expect(none.calls[0]!.headers.accept).toBe("application/xml");

    const xml = setup(() => new Response("<Invoice/>", { headers: { "content-type": "application/xml" } }));
    const f = await xml.client.salesDocumentXml("invoice", "i1");
    expect(f?.mimeType).toBe("application/xml");
    expect(new TextDecoder().decode(f!.bytes)).toBe("<Invoice/>");
  });

  it("Datei-Download: 406 → erneut mit */*, Dateiname aus filename*", async () => {
    const { client, calls } = setup((_url, headers) => {
      if (headers.accept !== "*/*") return json({ message: "Not Acceptable" }, 406);
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "content-type": "image/heic",
          "content-disposition": `attachment; filename="Beleg.heic"; filename*=UTF-8''Quittung%20B%C3%BCro%E2%82%AC.heic`,
        },
      });
    });
    const f = await client.file("f1");
    expect(f).toEqual({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/heic", filename: "Quittung Büro€.heic" });
    expect(calls.map((c) => c.headers.accept)).toEqual(["application/pdf, image/*, application/xml, */*", "*/*"]);
  });
});

describe("parseContentDispositionFilename", () => {
  it("unterstützt die üblichen Formen", () => {
    expect(parseContentDispositionFilename('attachment; filename="a b.pdf"')).toBe("a b.pdf");
    expect(parseContentDispositionFilename("attachment; filename=plain.pdf")).toBe("plain.pdf");
    expect(parseContentDispositionFilename("attachment; filename*=iso-8859-1'de'M%FCller.pdf")).toBe("Müller.pdf");
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''%ZZ; filename=fallback.pdf")).toBe("fallback.pdf");
    expect(parseContentDispositionFilename('attachment; filename="../../etc/passwd"')).toBe("passwd");
    expect(parseContentDispositionFilename("inline")).toBeNull();
  });
});
