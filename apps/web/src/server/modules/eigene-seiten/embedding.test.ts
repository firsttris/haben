import { describe, expect, it } from "vitest";
import { checkEmbedding, frameVerdict } from "./embedding.ts";

const HABEN = "https://haben.example.de";

function verdict(headers: Record<string, string>, habenUrl = HABEN) {
  return frameVerdict(new Headers(headers), habenUrl);
}

describe("frameVerdict", () => {
  it("erlaubt eine Seite ohne Header", () => {
    expect(verdict({})).toEqual({ status: "allowed" });
  });

  it("X-Frame-Options DENY und SAMEORIGIN verbieten das Einbetten, ALLOW-FROM kennt kein Browser mehr", () => {
    expect(verdict({ "X-Frame-Options": "DENY" })).toEqual({ status: "blocked", header: "X-Frame-Options: DENY" });
    // Paperless-ngx liefert Django-Standard
    expect(verdict({ "X-Frame-Options": "sameorigin" })).toEqual({ status: "blocked", header: "X-Frame-Options: SAMEORIGIN" });
    expect(verdict({ "X-Frame-Options": "ALLOW-FROM https://haben.example.de" })).toEqual({ status: "allowed" });
  });

  it("frame-ancestors geht X-Frame-Options vor", () => {
    expect(verdict({ "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors https://haben.example.de" })).toEqual({ status: "allowed" });
    expect(verdict({ "Content-Security-Policy": "default-src 'self'; frame-ancestors 'self'" })).toEqual({
      status: "blocked",
      header: "Content-Security-Policy: frame-ancestors",
    });
    expect(verdict({ "Content-Security-Policy": "frame-ancestors 'none'" }).status).toBe("blocked");
  });

  it("eine CSP ohne frame-ancestors lässt X-Frame-Options gelten", () => {
    expect(verdict({ "Content-Security-Policy": "default-src 'self'", "X-Frame-Options": "DENY" }).status).toBe("blocked");
    expect(verdict({ "Content-Security-Policy": "default-src 'self'" }).status).toBe("allowed");
  });

  it("vergleicht Quellen wie der Browser: Schema, Platzhalter für Subdomains und Port", () => {
    const allowed = (sources: string, habenUrl = HABEN) => verdict({ "Content-Security-Policy": `frame-ancestors ${sources}` }, habenUrl).status;
    expect(allowed("*")).toBe("allowed");
    expect(allowed("https:")).toBe("allowed");
    expect(allowed("http:")).toBe("allowed");
    expect(allowed("haben.example.de")).toBe("allowed");
    expect(allowed("*.example.de")).toBe("allowed");
    expect(allowed("*.example.de", "https://example.de")).toBe("blocked");
    expect(allowed("https://andere.example.de 'self'")).toBe("blocked");
    expect(allowed("http://haben.example.de")).toBe("allowed");
    expect(allowed("https://haben.example.de", "http://haben.example.de")).toBe("blocked");
    expect(allowed("http://192.168.1.10:3000", "http://192.168.1.10:3000")).toBe("allowed");
    expect(allowed("http://192.168.1.10", "http://192.168.1.10:3000")).toBe("blocked");
    expect(allowed("http://192.168.1.10:*", "http://192.168.1.10:3000")).toBe("allowed");
    expect(allowed("HTTPS://Haben.Example.de/pfad")).toBe("allowed");
  });

  it("mehrere Richtlinien gelten alle: eine verbietende reicht", () => {
    expect(verdict({ "Content-Security-Policy": "frame-ancestors *, frame-ancestors 'none'" }).status).toBe("blocked");
  });
});

describe("checkEmbedding", () => {
  it("liest die Header der Antwort", async () => {
    const fake = (async () => new Response("<html></html>", { headers: { "X-Frame-Options": "DENY" } })) as unknown as typeof fetch;
    expect(await checkEmbedding("https://paperless.example.de/", HABEN, fake)).toEqual({ status: "blocked", header: "X-Frame-Options: DENY" });
  });

  it("meldet unbekannt, wenn Haben die Seite nicht erreicht", async () => {
    const fake = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await checkEmbedding("https://paperless.example.de/", HABEN, fake)).toEqual({ status: "unknown", reason: "unreachable" });
  });
});
