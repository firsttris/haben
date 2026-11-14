import { describe, expect, it } from "vitest";
import { ladeKonfiguration } from "./env.ts";
import { anmeldeSeite, firmenSeite, SUCHE_AB } from "./seiten.ts";

/* Seiten und Konfiguration des Portals (#504): Escaping, Suchfeld ab 20 Firmen, Fehler beim Start. */

const firmen = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Firma ${String(i).padStart(2, "0")}`, url: `https://f${i}.example.de` }));

describe("Seiten", () => {
  it("escapen Namen aus der Konfiguration und die Suche", () => {
    const seite = firmenSeite([{ name: `<script>alert("x")</script>`, url: "https://a.example.de" }], "");
    expect(seite).not.toContain("<script>");
    expect(seite).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(anmeldeSeite(`"><img src=x>`)).not.toContain("<img");
    expect(firmenSeite(firmen(SUCHE_AB), `"><b>`)).toContain('value="&quot;&gt;&lt;b&gt;"');
  });

  it("zeigen das Suchfeld erst ab 20 Firmen und filtern ohne Groß- und Kleinschreibung", () => {
    expect(firmenSeite(firmen(SUCHE_AB - 1), "")).not.toContain('type="search"');
    const seite = firmenSeite(firmen(25), "FIRMA 1");
    expect(seite).toContain('type="search"');
    expect([...seite.matchAll(/<li>/g)]).toHaveLength(10);
    expect(firmenSeite(firmen(25), "gibt es nicht")).toContain("Keine Firma gefunden.");
  });
});

describe("ladeKonfiguration", () => {
  const gueltig = {
    PORTAL_URL: "https://portal.example.de",
    PORTAL_SECRET: "x".repeat(32),
    OIDC_ISSUER: "https://auth.example.de",
    OIDC_CLIENT_ID: "portal",
    OIDC_CLIENT_SECRET: "geheim",
  };

  it("nimmt eine gültige Konfiguration mit Vorgaben an", () => {
    const ergebnis = ladeKonfiguration(gueltig);
    expect(ergebnis).toMatchObject({ config: { url: "https://portal.example.de", displayName: "SSO", groupsClaim: "groups", firmen: [] } });
  });

  it.each([
    ["PORTAL_URL mit Pfad", { PORTAL_URL: "https://portal.example.de/x" }, "PORTAL_URL"],
    ["PORTAL_URL über http", { PORTAL_URL: "http://portal.example.de" }, "PORTAL_URL"],
    ["zu kurzes PORTAL_SECRET", { PORTAL_SECRET: "kurz" }, "PORTAL_SECRET"],
    ["Claim als Pfad", { OIDC_GROUPS_CLAIM: "realm_access.roles" }, "OIDC_GROUPS_CLAIM"],
    ["Issuer über http", { OIDC_ISSUER: "http://auth.example.de" }, "OIDC_ISSUER"],
    ["Issuer über http auf localhost im Betrieb", { OIDC_ISSUER: "http://localhost:9091", NODE_ENV: "production" }, "OIDC_ISSUER"],
    ["fehlerhafte PORTAL_FIRMEN", { PORTAL_FIRMEN: "Nord|https://nord.example.de" }, "PORTAL_FIRMEN"],
    ["fehlendes Client-Secret", { OIDC_CLIENT_SECRET: "" }, "OIDC_CLIENT_SECRET"],
  ])("lehnt %s ab und nennt die Variable", (_fall, abweichung, variable) => {
    const ergebnis = ladeKonfiguration({ ...gueltig, ...abweichung });
    expect(ergebnis).toHaveProperty("fehler");
    expect((ergebnis as { fehler: string[] }).fehler.join("\n")).toContain(variable);
  });
});
