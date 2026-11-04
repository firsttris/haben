import { describe, expect, it } from "vitest";
import { checkPageUrl } from "./url.ts";

const HABEN = "https://haben.example.de";

describe("checkPageUrl", () => {
  it("nimmt https und http auf einem anderen Host oder Port an und bereinigt die Adresse", () => {
    expect(checkPageUrl("  https://n8n.example.de/webhook/bestellungen  ", HABEN)).toEqual({ ok: true, url: "https://n8n.example.de/webhook/bestellungen" });
    expect(checkPageUrl("http://192.168.1.20:5678/form", HABEN)).toEqual({ ok: true, url: "http://192.168.1.20:5678/form" });
    // Gleicher Host, anderer Port: andere Herkunft, die Sitzung von Haben gilt dort nicht
    expect(checkPageUrl("https://haben.example.de:8443/", HABEN)).toEqual({ ok: true, url: "https://haben.example.de:8443/" });
  });

  it("lehnt andere Protokolle und unvollständige Adressen ab", () => {
    for (const raw of ["javascript:alert(1)", "data:text/html,<p>x</p>", "ftp://example.de/", "n8n.example.de", "", "/bestellungen"]) {
      expect(checkPageUrl(raw, HABEN), raw).toEqual({ ok: false, message: expect.stringMatching(/https:\/\//) });
    }
  });

  it("lehnt Zugangsdaten in der Adresse ab", () => {
    expect(checkPageUrl("https://max:geheim@n8n.example.de/", HABEN)).toEqual({ ok: false, message: expect.stringMatching(/Passwort/) });
  });

  it("lehnt die Herkunft von Haben selbst ab, auch mit anderem Pfad oder Großschreibung", () => {
    for (const raw of ["https://haben.example.de/bestellungen", "https://HABEN.example.de:443/", "https://haben.example.de"]) {
      expect(checkPageUrl(raw, HABEN), raw).toEqual({ ok: false, message: expect.stringMatching(/andere(n)? Adresse/) });
    }
  });
});
