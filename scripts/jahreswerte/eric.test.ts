import { describe, expect, it } from "vitest";
import { ericUrl, kandidaten, pruefeEric } from "./eric.ts";
import { antwort, type Nachgestellt, nachgestellt, netzwerkfehler } from "./nachgestellt.ts";

const da = antwort(206, "P", { "content-range": "bytes 0-0/521062399" });
const vorhanden = (...versionen: string[]): Record<string, Nachgestellt> => Object.fromEntries(versionen.map((v) => [ericUrl(v), da]));

describe("ERiC", () => {
  it("baut dieselbe Adresse wie install.ts", () => {
    expect(ericUrl("43.4.6.0")).toBe("https://download.elster.de/download/eric/eric_43/ERiC-43.4.6.0-Linux-x86_64.jar");
  });

  it("sucht nur oberhalb der eingestellten Version, bis zwei Hauptversionen voraus", () => {
    const k = kandidaten("43.4.6.0");
    expect(k[0]).toBe("43.4.7.0");
    expect(k).toContain("43.5.4.0");
    expect(k).toContain("44.0.0.0");
    expect(k).toContain("45.1.5.0");
    expect(k.at(-1)).toBe("45.9.12.0");
    expect(k).not.toContain("43.4.6.0");
    expect(k).not.toContain("46.0.0.0");
  });

  it("meldet nichts, wenn es nur die eingestellte Version gibt", async () => {
    const holen = nachgestellt(vorhanden("43.4.6.0"));
    expect(await pruefeEric("43.4.6.0", holen)).toEqual({ befunde: [], warnungen: [] });
    // Nur das erste Byte, ohne Weiterleitung
    expect(holen.aufrufe[0]?.init?.headers).toEqual({ Range: "bytes=0-0" });
  });

  it("meldet die neueste gefundene Version und nennt alle", async () => {
    const e = await pruefeEric("43.4.6.0", nachgestellt(vorhanden("43.4.6.0", "43.5.4.0", "44.3.6.0", "45.1.5.0")));
    expect(e.warnungen).toEqual([]);
    expect(e.befunde).toHaveLength(1);
    expect(e.befunde[0]?.schluessel).toBe("eric");
    expect(e.befunde[0]?.titel).toBe("ERiC 45.1.5.0 ist verfügbar (Haben: 43.4.6.0)");
    expect(e.befunde[0]?.text).toContain(ericUrl("43.5.4.0"));
    expect(e.befunde[0]?.text).toContain("DEFAULT_ERIC_VERSION");
    expect(e.befunde[0]?.text).toContain("checkUStVA_<Jahr>");
  });

  it("meldet, wenn die eingestellte Version vom Server genommen wurde", async () => {
    const e = await pruefeEric("43.4.6.0", nachgestellt(vorhanden("44.1.6.0")));
    expect(e.befunde.map((b) => b.schluessel)).toEqual(["eric-43.4.6.0-entfernt", "eric"]);
  });

  it("macht aus einem Server, der nicht antwortet, Warnungen statt Befunden", async () => {
    const alle = Object.fromEntries(["43.4.6.0", ...kandidaten("43.4.6.0")].map((v) => [ericUrl(v), antwort(503)]));
    const e = await pruefeEric("43.4.6.0", nachgestellt(alle));
    expect(e.befunde).toEqual([]);
    expect(e.warnungen).toEqual([
      `ERiC: ${ericUrl("43.4.6.0")} nicht erreichbar`,
      `ERiC: ${kandidaten("43.4.6.0").length} von ${kandidaten("43.4.6.0").length} Kandidaten bei https://download.elster.de/download/eric nicht erreichbar`,
    ]);
  });

  it("meldet eine gefundene Version auch, wenn einzelne Abfragen scheitern", async () => {
    const e = await pruefeEric("43.4.6.0", nachgestellt({ ...vorhanden("43.4.6.0", "44.1.6.0"), [ericUrl("43.4.7.0")]: netzwerkfehler }));
    expect(e.befunde.map((b) => b.titel)).toEqual(["ERiC 44.1.6.0 ist verfügbar (Haben: 43.4.6.0)"]);
    expect(e.warnungen).toHaveLength(1);
  });
});
