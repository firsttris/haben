import { describe, expect, it } from "vitest";
import { MailError } from "../errors.ts";
import type { OutgoingMail } from "../transport.ts";
import { createGraphTransport } from "./send.ts";

const mail: OutgoingMail = {
  from: { name: "Muster IT", address: "rechnung@firma.example" },
  to: "kunde@kunde.example",
  subject: "Rechnung",
  text: "Text",
  html: "<p>Text</p>",
};

type Call = { url: string; init: RequestInit };

/** Ein gemocktes `fetch`, das die Antworten der Reihe nach liefert; nichts verlässt den Rechner */
function setup(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const queue = [...responses];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error("keine Antwort vorbereitet");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  let tokens = 0;
  const transport = createGraphTransport("rechnung@firma.example", {
    tokenProvider: async () => `token-${++tokens}`,
    fetchFn,
    sleep: async (ms) => void sleeps.push(ms),
  });
  return { transport, calls, sleeps };
}

const accepted = () => new Response(null, { status: 202 });
const failure = (status: number, code: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code, message: "Meldung von Microsoft" } }), { status, headers: { "request-id": "req-123", ...headers } });
const reason = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (e: Error) => e.message,
  );

describe("Versand über Microsoft Graph (gemocktes fetch)", () => {
  it("sendet an das Postfach, mit Token, als JSON, und gilt bei 202 als gesendet", async () => {
    const { transport, calls } = setup([accepted()]);
    await transport.sendMail(mail);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://graph.microsoft.com/v1.0/users/rechnung%40firma.example/sendMail");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer token-1");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(calls[0]!.init.body as string).message.subject).toBe("Rechnung");
  });

  it("sendet aus einer Shared Mailbox, wenn sie als Postfach gesetzt ist", async () => {
    const calls: string[] = [];
    const transport = createGraphTransport("shared@firma.example", {
      tokenProvider: async () => "t",
      fetchFn: (async (url: string) => {
        calls.push(url);
        return accepted();
      }) as unknown as typeof fetch,
    });
    await transport.sendMail(mail);
    expect(calls[0]).toContain("/users/shared%40firma.example/sendMail");
  });

  it("wartet bei 429 die Zeit aus Retry-After (Sekunden) und versucht es erneut", async () => {
    const { transport, calls, sleeps } = setup([failure(429, "TooManyRequests", { "retry-after": "2" }), accepted()]);
    await transport.sendMail(mail);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it("liest Retry-After auch als Datum und wartet bei 503 ohne Angabe 1 s, dann 2 s", async () => {
    const date = new Date(Date.now() + 5000).toUTCString();
    const first = setup([failure(503, "ServiceUnavailable", { "retry-after": date }), accepted()]);
    await first.transport.sendMail(mail);
    expect(first.sleeps[0]).toBeGreaterThan(2000);
    expect(first.sleeps[0]).toBeLessThanOrEqual(5000);
    const second = setup([failure(503, "ServiceUnavailable"), failure(503, "ServiceUnavailable"), accepted()]);
    await second.transport.sendMail(mail);
    expect(second.sleeps).toEqual([1000, 2000]);
  });

  it("gibt nach drei Versuchen auf", async () => {
    const { transport, calls } = setup([failure(429, "TooManyRequests"), failure(429, "TooManyRequests"), failure(429, "TooManyRequests")]);
    expect(await reason(transport.sendMail(mail))).toContain("überlastet");
    expect(calls).toHaveLength(3);
  });

  it("wartet nicht länger als 30 Sekunden insgesamt", async () => {
    const { transport, calls, sleeps } = setup([failure(429, "TooManyRequests", { "retry-after": "120" })]);
    expect(await reason(transport.sendMail(mail))).toContain("überlastet");
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("wiederholt nach einem Netzfehler oder einem anderen 5xx nicht, damit keine Rechnung doppelt ankommt", async () => {
    const timeout = setup([new Error("The operation was aborted due to timeout")]);
    expect(await reason(timeout.transport.sendMail(mail))).toBe("Keine Verbindung zu Microsoft 365: The operation was aborted due to timeout");
    expect(timeout.calls).toHaveLength(1);
    const server = setup([failure(500, "InternalServerError"), accepted()]);
    expect(await reason(server.transport.sendMail(mail))).toContain("HTTP 500");
    expect(server.calls).toHaveLength(1);
  });

  it.each([
    [400, "ErrorInvalidRecipients", "Empfänger oder Inhalt ungültig"],
    [401, "InvalidAuthenticationToken", "Anmeldung der App bei Microsoft 365 wurde abgelehnt"],
    [403, "ErrorAccessDenied", "darf nicht aus dem Postfach rechnung@firma.example senden"],
    [404, "ErrorInvalidUser", "Postfach rechnung@firma.example gibt es nicht"],
    [413, "ErrorMessageSizeExceeded", "zu groß"],
  ])("meldet HTTP %i auf Deutsch mit Code und Anfrage-ID", async (status, code, text) => {
    const { transport, calls } = setup([failure(status, code)]);
    const message = (await reason(transport.sendMail(mail)))!;
    expect(message).toContain(text);
    expect(message).toContain(`${code}: Meldung von Microsoft`);
    expect(message).toContain("Anfrage-ID req-123");
    expect(calls).toHaveLength(1);
  });

  it("meldet eine Antwort ohne lesbaren Körper ohne Code", async () => {
    const { transport } = setup([new Response("<html>", { status: 502 })]);
    expect(await reason(transport.sendMail(mail))).toBe("Microsoft 365 ist gerade nicht erreichbar (HTTP 502). Bitte später erneut versuchen.");
  });

  it("sendet zu große Anhänge gar nicht erst", async () => {
    const { transport, calls } = setup([accepted()]);
    const message = await reason(
      transport.sendMail({ ...mail, attachments: [{ filename: "x.pdf", content: Buffer.alloc(3_000_000), contentType: "application/pdf" }] }),
    );
    expect(message).toContain("zu groß");
    expect(calls).toHaveLength(0);
  });

  it("reicht einen Fehler bei der Anmeldung weiter, ohne zu senden", async () => {
    const calls: string[] = [];
    const transport = createGraphTransport("a@b.example", {
      tokenProvider: async () => {
        throw new MailError("Die Anmeldung bei Microsoft Entra ID ist fehlgeschlagen: AADSTS7000215");
      },
      fetchFn: (async (url: string) => void calls.push(url)) as unknown as typeof fetch,
    });
    expect(await reason(transport.sendMail(mail))).toContain("AADSTS7000215");
    expect(calls).toHaveLength(0);
  });
});
