import { describe, expect, it } from "vitest";
import antworten from "../../test-fixtures/sevdesk/buchhaltung-1.0/accounting-type.json";
import { SevdeskApiError, SevdeskClient } from "./client.ts";

/*
 * GET /AccountingType/{id} steht nicht unter den Pfaden der OpenAPI, nur im Abschnitt „Accounting type“ (Tag Voucher,
 * „Use this in sevdesk-Update 1.0“). Gelesen wird der Kontostamm einer Gutschrift mit `bookingCategory` ACCOUNTING_TYPE
 * (#472); die Antwort wird unverändert gespeichert.
 */

const dienstleister = antworten[0]!;

function client(handler: (url: URL, init?: RequestInit) => Response) {
  const calls: { url: URL; method: string }[] = [];
  const c = new SevdeskClient({
    apiKey: "token",
    minIntervalMs: 0,
    maxRetries: 0,
    sleep: async () => {},
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, method: init?.method ?? "GET" });
      return handler(url, init);
    }) as typeof fetch,
  });
  return { client: c, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("SevdeskClient.accountingType", () => {
  it.each([
    ["als Liste", (o: object) => ({ objects: [o] })],
    ["als Objekt", (o: object) => ({ objects: o })],
  ])("liest die Antwort %s und behält unbekannte Felder", async (_form, wrap) => {
    const { client: c, calls } = client(() => json(wrap({ ...dienstleister, skrAt: "5770", parent: { id: "45", objectName: "AccountingType" } })));
    const konto = await c.accountingType("ID_66");
    expect(konto).toMatchObject({ id: "ID_66", skr03: "3100", skr04: "5900", translationCode: "ACCOUNTING_TYPE_SERVICE_PROVIDER", skrAt: "5770" });
    expect(konto.parent).toEqual({ id: "45", objectName: "AccountingType" });
    expect(calls.map((x) => [x.method, x.url.pathname])).toEqual([["GET", "/api/v1/AccountingType/ID_66"]]);
  });

  it("lehnt eine Antwort zu einer anderen ID ab", async () => {
    const { client: c } = client(() => json({ objects: [antworten[1]] }));
    await expect(c.accountingType("ID_66")).rejects.toBeInstanceOf(SevdeskApiError);
  });

  it("meldet 404 als Fehler mit Status", async () => {
    const { client: c } = client(() => json({ error: { message: "not found" } }, 404));
    await expect(c.accountingType("ID_99")).rejects.toMatchObject({ status: 404 });
  });

  it("bricht bei 401 mit dem Hinweis auf den Token ab", async () => {
    const { client: c } = client(() => json({}, 401));
    await expect(c.accountingType("ID_66")).rejects.toMatchObject({ status: 401, message: "API-Token ungültig oder abgelaufen" });
  });
});
