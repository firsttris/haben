import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileResponse } from "./file-response.ts";
import { FRAME_ANCESTORS, withFrameAncestors } from "./security-headers.ts";

describe("withFrameAncestors", () => {
  it("setzt frame-ancestors auf HTML-Seiten", async () => {
    const response = withFrameAncestors(new Response("<!doctype html>", { headers: { "Content-Type": "text/html; charset=utf-8" } }));
    expect(response.headers.get("content-security-policy")).toBe(FRAME_ANCESTORS);
    expect(await response.text()).toBe("<!doctype html>");
  });

  it("lässt Dateien mit eigener CSP und andere Inhalte unverändert", () => {
    const pdf = fileResponse(new Uint8Array([1]), { mimeType: "application/pdf", filename: "beleg.pdf" }, false);
    expect(withFrameAncestors(pdf)).toBe(pdf);
    const json = new Response("{}", { headers: { "Content-Type": "application/json" } });
    expect(withFrameAncestors(json).headers.has("content-security-policy")).toBe(false);
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
