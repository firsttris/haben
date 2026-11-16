/**
 * Das Werkzeug prüft PORTAL_FIRMEN selbst, weil es nichts aus packages/core importieren darf (es läuft ohne
 * bun install). Hier laufen dieselben Fälle durch portal und gegen parsePortalFirmen des Firmenportals (#1036): Was
 * das Werkzeug schreibt, nimmt das Firmenportal an, und was das Firmenportal ablehnte, schreibt das Werkzeug nicht.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parsePortalFirmen } from "../../packages/core/src/firmen.ts";
import { envSetzen, envWerte } from "./env-datei.ts";
import { umgebung } from "./test-docker.ts";

let t: ReturnType<typeof umgebung>;
beforeEach(() => {
  t = umgebung();
  t.eingabe("geheim\n");
});
afterEach(() => t.aufraeumen());

const SSO = ["--sso", "--oidc-issuer", "https://auth.example.de", "--oidc-client-id", "x", "--oidc-client-secret-stdin"];

/** Zwei Instanzen mit SSO; `werte` setzt HABEN_FIRMENNAME oder OIDC_GROUP_INHABER je Instanz von Hand */
async function zwei(werte: [instanz: "a" | "b", key: string, wert: string][], zeichen: Record<string, unknown> = {}) {
  for (const n of ["a", "b"]) expect((await t.lauf("neu", n, `${n}.example.de`, "--nicht-starten", ...SSO)).status).toBe(0);
  for (const [n, key, wert] of werte) {
    const datei = join(t.basis, n, ".env");
    writeFileSync(datei, envSetzen(readFileSync(datei, "utf8"), key, wert, true));
  }
  for (const [n, z] of Object.entries(zeichen)) t.docker.z.zeichen.set(n, z);
  return t.lauf("portal", "portal.example.de", "--oidc-issuer", "https://auth.example.de", "--oidc-client-id", "p", "--oidc-client-secret-stdin");
}

type Fall = [beschreibung: string, werte: Parameters<typeof zwei>[0], zeichen?: Record<string, unknown>];

const FAELLE: Fall[] = [
  ["Vorgaben aus neu", []],
  ["Name mit Sonderzeichen außer | ; '", [["a", "HABEN_FIRMENNAME", 'Müller & Söhne (Süd) $1 #2 "x"']]],
  ["Name mit 60 Zeichen", [["a", "HABEN_FIRMENNAME", "x".repeat(60)]]],
  ["Name mit 61 Zeichen", [["a", "HABEN_FIRMENNAME", "x".repeat(61)]]],
  ["Name mit |", [["a", "HABEN_FIRMENNAME", "A|B"]]],
  ["Name mit ;", [["a", "HABEN_FIRMENNAME", "A;B"]]],
  [
    "doppelter Name",
    [
      ["a", "HABEN_FIRMENNAME", "Nord"],
      ["b", "HABEN_FIRMENNAME", "Nord"],
    ],
  ],
  ["Gruppe mit 100 Zeichen", [["a", "OIDC_GROUP_INHABER", "g".repeat(100)]]],
  ["Gruppe mit 101 Zeichen", [["a", "OIDC_GROUP_INHABER", "g".repeat(101)]]],
  ["Gruppe mit Leerzeichen", [["a", "OIDC_GROUP_INHABER", "haben a"]]],
  ["Gruppe mit |", [["a", "OIDC_GROUP_INHABER", "haben|a"]]],
  [
    "doppelte Gruppe",
    [
      ["a", "OIDC_GROUP_INHABER", "inhaber"],
      ["b", "OIDC_GROUP_INHABER", "inhaber"],
    ],
  ],
  ["Farbe in Kleinbuchstaben", [], { a: { farbe: "#1d4ed8", logo: null } }],
  ["Farbe ohne #", [], { a: { farbe: "1D4ED8", logo: null } }],
  ["Farbe als Name", [], { a: { farbe: "red; x", logo: null } }],
];

describe("PORTAL_FIRMEN aus dem Werkzeug und im Firmenportal", () => {
  it.each(FAELLE)("%s: das Werkzeug schreibt nur, was das Firmenportal annimmt, und nennt die Firmen gleich", async (_fall, werte, zeichen) => {
    const r = await zwei(werte, zeichen);
    const liste = envWerte(readFileSync(join(t.basis, "firmenportal", ".env"), "utf8")).get("PORTAL_FIRMEN") ?? "";
    if (r.status !== 0) {
      // Abgebrochen: noch nichts in der Liste, und das Firmenportal hätte den Eintrag auch abgelehnt
      expect(liste).toBe("");
      const eintraege = ["a", "b"].map((n) => {
        const env = envWerte(readFileSync(join(t.basis, n, ".env"), "utf8"));
        return `${env.get("HABEN_FIRMENNAME") ?? n}|https://${n}.example.de|${env.get("OIDC_GROUP_INHABER") ?? ""}`;
      });
      expect(parsePortalFirmen(eintraege.join(";"))).toHaveProperty("fehler");
      return;
    }
    const geparst = parsePortalFirmen(liste);
    expect(geparst).toHaveProperty("firmen");
    const firmen = (geparst as { firmen: { name: string; gruppe: string; farbe: string | null }[] }).firmen;
    for (const n of ["a", "b"] as const) {
      const env = envWerte(readFileSync(join(t.basis, n, ".env"), "utf8"));
      const firma = firmen.find((f) => f.gruppe === env.get("OIDC_GROUP_INHABER"));
      expect(firma?.name).toBe(env.get("HABEN_FIRMENNAME") ?? n);
    }
    // Eine ungültige Farbe aus dem Status wird zur Kachel mit Buchstaben, nie zu einem Abbruch
    const farbe = (zeichen?.a as { farbe?: string } | undefined)?.farbe;
    expect(firmen.find((f) => f.gruppe === "haben-a-inhaber")?.farbe ?? null).toBe(farbe && /^#[0-9a-f]{6}$/i.test(farbe) ? farbe.toUpperCase() : null);
  });
});
