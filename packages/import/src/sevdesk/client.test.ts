import { describe, expect, it } from "vitest";
import { SevdeskApiError, SevdeskClient } from "./client.ts";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function setup(handler: (url: URL, headers: Record<string, string>) => Response | Promise<Response>, opts: { maxRetries?: number } = {}) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const sleeps: number[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url, headers });
    return handler(url, headers);
  }) as typeof fetch;
  const client = new SevdeskClient({
    apiKey: "token",
    fetch: fetchFn,
    minIntervalMs: 0,
    maxRetries: opts.maxRetries,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { client, calls, sleeps };
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

describe("SevdeskClient", () => {
  it("liest einen Quellstand und dekodiert das geprüfte V1-Auftrags-PDF mit preventSendBy", async () => {
    const { client, calls } = setup((url) =>
      json({
        objects: url.pathname.endsWith("/getPdf")
          ? { filename: "angebot.pdf", mimetype: "application/pdf", base64Encoded: true, content: Buffer.from("%PDF-1.4 Test").toString("base64") }
          : [{ id: "1", orderType: "AN", status: "100", version: "0" }],
      }),
    );
    expect(await client.order("1")).toMatchObject({ id: "1", status: "100" });
    expect(new TextDecoder().decode((await client.orderPdf("1"))!.bytes)).toBe("%PDF-1.4 Test");
    expect(calls[1]!.url.searchParams.get("preventSendBy")).toBe("true");
  });

  it.each(["netzwerk", "503"])("wiederholt Auftrags-PDF-Anfragen nach %s nicht", async (kind) => {
    const { client, calls, sleeps } = setup(
      () => {
        if (kind === "netzwerk") throw new TypeError("Verbindung unterbrochen");
        return json({}, 503);
      },
      { maxRetries: 3 },
    );
    await expect(client.orderPdf("1")).rejects.toBeInstanceOf(SevdeskApiError);
    expect(calls).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
  });

  it("erhält lückenhafte Objekt-Schlüssel der Beziehungen teilberechneter Aufträge", async () => {
    const related = {
      "0": { id: "81", objectName: "Invoice", invoiceNumber: "RE-2026-1", status: "1000" },
      "3": { id: "92", objectName: "Order", orderType: "LI", orderNumber: "LS-2026-1" },
    };
    const { client, calls } = setup(() => json({ objects: related }));
    expect(await client.orderRelatedObjects("75")).toEqual(related);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.search).toBe("");
  });

  it("liest Auftragsarten, Positionen und Verknüpfungen ohne PDF-Aufruf", async () => {
    const { client, calls } = setup((url) => json({ objects: url.pathname.endsWith("/Order") ? [{ id: "1", orderType: "AN", status: "200" }] : [] }));
    expect(await collect(client.orders())).toMatchObject([{ id: "1", orderType: "AN" }]);
    await client.orderPositions("1");
    await client.orderRelatedObjects("1");
    expect(calls.map((c) => c.url.pathname)).toEqual(["/api/v1/Order", "/api/v1/Order/1/getPositions", "/api/v1/Order/1/getRelatedObjects"]);
  });

  it("schickt den Token unverändert und blättert mit limit und offset", async () => {
    const all = Array.from({ length: 150 }, (_, i) => ({ id: String(i + 1), name: `Kontakt ${i + 1}` }));
    const { client, calls } = setup((url) => {
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      return json({ objects: all.slice(offset, offset + limit) });
    });
    const contacts = await collect(client.contacts());
    expect(contacts).toHaveLength(150);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.pathname).toBe("/api/v1/Contact");
    expect(calls[0]!.url.searchParams.get("depth")).toBe("1");
    expect(calls[1]!.url.searchParams.get("offset")).toBe("100");
    expect(calls[0]!.headers.authorization).toBe("token");
  });

  it("filtert Positionen nach Beleg", async () => {
    const { client, calls } = setup(() => json({ objects: [{ id: 1, taxRate: "19", sumNet: "10" }] }));
    await client.voucherPositions("301");
    expect(calls[0]!.url.pathname).toBe("/api/v1/VoucherPos");
    expect(calls[0]!.url.searchParams.get("voucher[id]")).toBe("301");
    expect(calls[0]!.url.searchParams.get("voucher[objectName]")).toBe("Voucher");
  });

  it("dekodiert PDFs aus getPdf und markiert die Rechnung nicht als versendet", async () => {
    const pdf = "%PDF-1.4 Rechnung";
    const { client, calls } = setup(() =>
      json({ objects: { filename: "RE-1001.pdf", mimeType: "application/pdf", base64encoded: true, content: Buffer.from(pdf).toString("base64") } }),
    );
    const file = await client.invoicePdf("101");
    expect(new TextDecoder().decode(file!.bytes)).toBe(pdf);
    expect(file!.filename).toBe("RE-1001.pdf");
    expect(file!.mimeType).toBe("application/pdf");
    expect(calls[0]!.url.searchParams.get("preventSendBy")).toBe("true");
  });

  it("nimmt Belegdateien auch als rohe Bytes und gibt bei 404 null", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const { client } = setup((url) =>
      url.pathname.endsWith("/880/download")
        ? new Response(jpeg, { headers: { "content-type": "image/jpeg", "content-disposition": 'attachment; filename="beleg.jpg"' } })
        : json({ error: { message: "not found" } }, 404),
    );
    expect(await client.document("880")).toEqual({ bytes: jpeg, mimeType: "image/jpeg", filename: "beleg.jpg" });
    expect(await client.document("881")).toBeNull();
  });

  it("liefert E-Rechnungs-XML nur, wenn es eines gibt", async () => {
    const { client } = setup((url) =>
      url.pathname.includes("/101/") ? json({ objects: '<?xml version="1.0"?><Invoice/>' }) : json({ error: { message: "keine E-Rechnung" } }, 400),
    );
    expect(new TextDecoder().decode((await client.invoiceXml("101"))!.bytes)).toContain("<Invoice/>");
    expect(await client.invoiceXml("102")).toBeNull();
  });

  it("wiederholt bei 429 nach Retry-After und meldet einen falschen Token verständlich", async () => {
    let n = 0;
    const { client, sleeps } = setup(() => (n++ === 0 ? json({}, 429, { "retry-after": "2" }) : json({ objects: { version: "2.0" } })));
    expect(await client.bookkeepingSystemVersion()).toBe("2.0");
    expect(sleeps).toEqual([2000]);

    const denied = setup(() => json({ error: { message: "Authentication required" } }, 401));
    const error = await denied.client.bookkeepingSystemVersion().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SevdeskApiError);
    expect((error as SevdeskApiError).message).toBe("API-Token ungültig oder abgelaufen");
  });

  it("meldet unerwartete Antworten mit dem Feld", async () => {
    const { client } = setup(() => json({ objects: [{ name: "ohne id" }] }));
    await expect(collect(client.invoices())).rejects.toThrow(/Unerwartete Antwort von GET \/Invoice: Feld „objects.0.id“/);
  });
});
