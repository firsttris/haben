import { describe, expect, it } from "vitest";
import { FastbillApiError, FastbillClient, type FastbillClientOptions } from "./client.ts";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function envelope(response: Record<string, unknown>): Response {
  return json({ REQUEST: {}, RESPONSE: response });
}

function setup(handler: (call: Call) => Response | Promise<Response>, opts: Partial<FastbillClientOptions> = {}) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let clock = opts.now ? 0 : 1_000_000;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  const client = new FastbillClient({
    email: "max@example.de",
    apiKey: "schluessel",
    fetch: fetchFn,
    minIntervalMs: 0,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    ...opts,
  });
  return { client, calls, sleeps, tick: (ms: number) => (clock += ms) };
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

const invoice = (n: number) => ({ INVOICE_ID: String(n), TYPE: "outgoing", INVOICE_NUMBER: `RE-${n}`, TOTAL: "119.00" });

describe("FastbillClient", () => {
  it("ruft Dienste per POST mit Basic Auth und dem Umschlag SERVICE, FILTER, LIMIT, OFFSET auf", async () => {
    const { client, calls } = setup(() => envelope({ CUSTOMERS: [{ CUSTOMER_ID: "7", ORGANIZATION: "Muster GmbH" }] }));
    expect(await collect(client.customers())).toMatchObject([{ CUSTOMER_ID: "7", ORGANIZATION: "Muster GmbH" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://my.fastbill.com/api/1.0/api.php");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from("max@example.de:schluessel").toString("base64")}`);
    expect(calls[0]!.headers["content-type"]).toBe("application/json");
    expect(calls[0]!.body).toEqual({ SERVICE: "customer.get", FILTER: {}, LIMIT: 100, OFFSET: 0 });
  });

  it("blättert in Seiten zu 100, bis eine Seite kürzer ist, und überspringt doppelte IDs", async () => {
    const { client, calls } = setup(({ body }) => {
      const offset = body!.OFFSET as number;
      if (offset === 0) return envelope({ INVOICES: Array.from({ length: 100 }, (_, i) => invoice(i + 1)) });
      // Überlappung an der Seitengrenze, etwa weil zwischendurch eine Rechnung dazukam
      return envelope({ INVOICES: [invoice(100), invoice(101)] });
    });
    const all = await collect(client.invoices());
    expect(all).toHaveLength(101);
    expect(calls.map((c) => c.body!.OFFSET)).toEqual([0, 100]);
  });

  it("gibt den Filter unverändert weiter", async () => {
    const { client, calls } = setup(() => envelope({ EXPENSES: [] }));
    await collect(client.expenses({ START_DATE: "2025-01-01", END_DATE: "2025-12-31" }));
    expect(calls[0]!.body).toMatchObject({ SERVICE: "expense.get", FILTER: { START_DATE: "2025-01-01", END_DATE: "2025-12-31" } });
  });

  it("liest eine Liste unter unbekanntem Namen, ein einzelnes Objekt und eine Antwort ohne Liste", async () => {
    const a = setup(() => envelope({ EXPENSE: [{ INVOICE_ID: 1, ORGANIZATION: "Lieferant" }] }));
    expect(await collect(a.client.expenses())).toMatchObject([{ INVOICE_ID: 1 }]);
    const b = setup(() => envelope({ INVOICES: invoice(5) }));
    expect(await collect(b.client.invoices())).toMatchObject([{ INVOICE_ID: "5" }]);
    const c = setup(() => envelope({}));
    expect(await collect(c.client.invoices())).toEqual([]);
  });

  it("bewahrt unbekannte Felder für das Archiv", async () => {
    const { client } = setup(() => envelope({ INVOICES: [{ ...invoice(1), NEUES_FELD: { X: 1 } }] }));
    const [first] = await collect(client.invoices());
    expect(first).toMatchObject({ NEUES_FELD: { X: 1 } });
  });

  it("wirft ERRORS aus der Antwort als Fehler, auch bei HTTP 200", async () => {
    const { client } = setup(() => json({ REQUEST: {}, RESPONSE: { ERRORS: ["Unknown service"] } }));
    await expect(collect(client.invoices())).rejects.toThrow("FastBill meldet bei invoice.get: Unknown service");
  });

  it("meldet falsche Zugangsdaten verständlich und ohne Wiederholung", async () => {
    const { client, calls } = setup(() => json({}, 401));
    const err = await client.verify().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FastbillApiError);
    expect((err as FastbillApiError).message).toBe("Login-E-Mail oder API-Schlüssel falsch");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ SERVICE: "customer.get", LIMIT: 1 });
  });

  it("wiederholt bei 503 und Netzwerkfehlern mit Wartezeit, bei 429 nach Retry-After", async () => {
    let n = 0;
    const { client, sleeps } = setup(() => {
      n++;
      if (n === 1) return json({}, 503);
      if (n === 2) throw new TypeError("Verbindung unterbrochen");
      if (n === 3) return json({}, 429, { "retry-after": "30" });
      return envelope({ CUSTOMERS: [] });
    });
    await collect(client.customers());
    expect(n).toBe(4);
    expect(sleeps).toEqual([1000, 2000, 30_000]);
  });

  it("wirft nach den erlaubten Wiederholungen", async () => {
    const { client, calls } = setup(() => json({}, 502), { maxRetries: 2 });
    await expect(collect(client.customers())).rejects.toMatchObject({ status: 502, service: "customer.get" });
    expect(calls).toHaveLength(3);
  });

  it("hält die Stundengrenze ein und meldet die Wartezeit", async () => {
    const waits: number[] = [];
    const { client, calls, sleeps } = setup(
      ({ body }) => {
        const offset = body!.OFFSET as number;
        return envelope({ INVOICES: offset < 300 ? Array.from({ length: 100 }, (_, i) => invoice(offset + i)) : [] });
      },
      { callsPerHour: 2, onRateLimitWait: (ms) => waits.push(ms) },
    );
    await collect(client.invoices());
    // vier Seiten bei zwei Aufrufen je Stunde: vor dem dritten eine Stunde warten, danach ist das Fenster wieder frei
    expect(calls).toHaveLength(4);
    expect(waits).toEqual([3_600_000]);
    expect(sleeps).toEqual([3_600_000]);
  });

  it("rechnet Aufrufe eines früheren Laufs auf die Stundengrenze an", async () => {
    const waits: number[] = [];
    const { client } = setup(() => envelope({ CUSTOMERS: [] }), {
      callsPerHour: 2,
      now: () => 10_000_000,
      previousCalls: [10_000_000 - 600_000, 10_000_000 - 300_000],
      onRateLimitWait: (ms) => waits.push(ms),
    });
    await collect(client.customers());
    expect(waits).toEqual([3_000_000]);
  });

  it("gibt die Aufrufe der letzten Stunde zum Speichern heraus", async () => {
    const { client, tick } = setup(() => envelope({ CUSTOMERS: [] }));
    await client.verify();
    tick(3_600_001);
    await client.verify();
    expect(client.recentCalls()).toHaveLength(1);
  });

  it("bricht ab, wenn das Signal gesetzt ist, ohne weiteren Aufruf", async () => {
    const controller = new AbortController();
    controller.abort();
    const { client, calls } = setup(() => envelope({ CUSTOMERS: [] }), { signal: controller.signal });
    await expect(collect(client.customers())).rejects.toThrow("Import abgebrochen");
    expect(calls).toHaveLength(0);
  });

  describe("document", () => {
    it("lädt das PDF hinter DOCUMENT_URL mit Anmeldung und Dateiname", async () => {
      const { client, calls } = setup(
        () =>
          new Response("%PDF-1.4 Test", {
            headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="RE-1.pdf"' },
          }),
      );
      const file = await client.document("https://my.fastbill.com/download.php?id=abc");
      expect(new TextDecoder().decode(file!.bytes)).toBe("%PDF-1.4 Test");
      expect(file).toMatchObject({ mimeType: "application/pdf", filename: "RE-1.pdf" });
      expect(calls[0]!.method).toBe("GET");
      expect(calls[0]!.headers.authorization).toMatch(/^Basic /);
    });

    it.each([
      ["Anmeldeseite statt PDF", () => new Response("<html>Login</html>", { headers: { "content-type": "text/html" } })],
      ["404", () => json({}, 404)],
      ["403", () => json({}, 403)],
    ])("liefert null bei %s", async (_name, response) => {
      const { client } = setup(response);
      expect(await client.document("https://my.fastbill.com/x.pdf")).toBeNull();
    });

    it.each(["http://my.fastbill.com/x.pdf", "https://example.com/x.pdf", "https://fastbill.com.example.org/x.pdf", "kein-link"])(
      "schickt die Anmeldung nie an %s",
      async (url) => {
        const { client, calls } = setup(() => new Response("x"));
        await expect(client.document(url)).rejects.toBeInstanceOf(FastbillApiError);
        expect(calls).toHaveLength(0);
      },
    );
  });

  it("verlangt E-Mail und API-Schlüssel", () => {
    expect(() => new FastbillClient({ email: " ", apiKey: "x" })).toThrow("Login-E-Mail fehlt");
    expect(() => new FastbillClient({ email: "a@b.de", apiKey: "" })).toThrow("API-Schlüssel fehlt");
  });
});
