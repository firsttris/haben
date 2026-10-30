import { isCsrfRequestAllowed } from "@tanstack/react-start";
import { beforeAll, describe, expect, it } from "vitest";
import { csrfOptions } from "./csrf.ts";

describe("Schutz vor Anfragen fremder Seiten", () => {
  beforeAll(() => {
    Object.assign(process.env, {
      DATABASE_URL: "postgres://localhost/haben",
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "https://haben.example.de",
      HABEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
    });
  });

  // Hinter Caddy sieht die App http://app:3000, die Herkunft ist trotzdem BETTER_AUTH_URL
  const allowed = async (method: string, pathname: string, headers: Record<string, string>) => {
    const request = new Request(`http://app:3000${pathname}`, { method, headers });
    const ctx = { request, pathname } as Parameters<typeof isCsrfRequestAllowed>[1];
    if (!(await csrfOptions.filter!(ctx))) return true;
    return isCsrfRequestAllowed(csrfOptions, ctx);
  };
  const serverFn = "/_serverFn/abc";

  it("lässt schreibende Anfragen nur von der eigenen Seite zu", async () => {
    expect(await allowed("POST", serverFn, { "sec-fetch-site": "same-origin" })).toBe(true);
    expect(await allowed("POST", serverFn, { "sec-fetch-site": "cross-site" })).toBe(false);
    // Nachbar-Subdomain: SameSite=Lax schickt das Cookie mit, die Prüfung nicht
    expect(await allowed("POST", serverFn, { "sec-fetch-site": "same-site" })).toBe(false);
    expect(await allowed("POST", serverFn, { origin: "https://haben.example.de" })).toBe(true);
    expect(await allowed("POST", serverFn, { origin: "https://andere.example.de" })).toBe(false);
    expect(await allowed("POST", "/api/auth/sign-out", { origin: "https://boese.example" })).toBe(false);
    expect(await allowed("POST", serverFn, { referer: "https://boese.example/seite" })).toBe(false);
  });

  it("prüft keine lesenden Anfragen und keine Pfade mit eigener Prüfung", async () => {
    expect(await allowed("GET", serverFn, { "sec-fetch-site": "cross-site" })).toBe(true);
    expect(await allowed("POST", "/api/mcp", { "sec-fetch-site": "cross-site" })).toBe(true);
    expect(await allowed("POST", "/api/belege/teilen", { "sec-fetch-site": "none" })).toBe(true);
    // Ohne jeden Herkunfts-Header (kein Browser) entscheidet die Anmeldung
    expect(await allowed("POST", serverFn, {})).toBe(true);
  });
});
