import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileResponse } from "./file-response.ts";
import { FRAME_ANCESTORS, NO_STORE, withCacheControl, withFrameAncestors } from "./security-headers.ts";

describe("withFrameAncestors", () => {
  it("setzt frame-ancestors auf HTML-Seiten", async () => {
    const response = withFrameAncestors(new Response("<!doctype html>", { headers: { "Content-Type": "text/html; charset=utf-8" } }));
    expect(response.headers.get("content-security-policy")).toBe(FRAME_ANCESTORS);
    expect(await response.text()).toBe("<!doctype html>");
  });

  it("verbietet für die OAuth-Zustimmung jede Einbettung, auch von derselben Origin (RFC 9700, 4.16)", () => {
    const html = () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
    const zustimmung = withFrameAncestors(html(), "/oauth/autorisieren");
    expect(zustimmung.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(zustimmung.headers.get("x-frame-options")).toBe("DENY");
    const andere = withFrameAncestors(html(), "/oauth/autorisieren-nicht");
    expect(andere.headers.get("content-security-policy")).toBe(FRAME_ANCESTORS);
    expect(andere.headers.has("x-frame-options")).toBe(false);
  });

  it("lässt Dateien mit eigener CSP und andere Inhalte unverändert", () => {
    const pdf = fileResponse(new Uint8Array([1]), { mimeType: "application/pdf", filename: "beleg.pdf" }, false);
    expect(withFrameAncestors(pdf)).toBe(pdf);
    const json = new Response("{}", { headers: { "Content-Type": "application/json" } });
    expect(withFrameAncestors(json).headers.has("content-security-policy")).toBe(false);
  });
});

describe("withCacheControl", () => {
  it("verbietet geteilten Caches Seiten, Server-Funktionen und API-Antworten ohne eigenen Header", async () => {
    for (const contentType of ["text/html; charset=utf-8", "application/json", "application/x-tss-framed"]) {
      const response = withCacheControl(new Response("{}", { headers: { "Content-Type": contentType } }));
      expect(response.headers.get("cache-control"), contentType).toBe(NO_STORE);
      expect(await response.text()).toBe("{}");
    }
    const weiterleitung = withCacheControl(Response.redirect("http://localhost/login", 307));
    expect(weiterleitung.status).toBe(307);
    expect(weiterleitung.headers.get("cache-control")).toBe(NO_STORE);
  });

  it("lässt einen eigenen Cache-Control unverändert", () => {
    const pdf = fileResponse(new Uint8Array([1]), { mimeType: "application/pdf", filename: "beleg.pdf" }, false);
    expect(withCacheControl(pdf)).toBe(pdf);
    const kennzeichen = new Response("", { headers: { "Cache-Control": "private, max-age=31536000, immutable" } });
    expect(withCacheControl(kennzeichen).headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  });
});

// Die Vorschauen von Belegen, Rechnungen und Angeboten sind iframes auf derselben Origin; DENY verbietet auch die
describe("mitgelieferte Proxy-Konfiguration", () => {
  const root = new URL("../../../../", import.meta.url);
  it.each(["deploy/Caddyfile", "deploy/compose.yml"])("%s erlaubt Einbettung von derselben Origin", (path) => {
    const text = readFileSync(new URL(path, root), "utf8");
    expect(text).not.toMatch(/X-Frame-Options\s+DENY/i);
    expect(text).toMatch(/X-Frame-Options\s+SAMEORIGIN/);
  });
});
