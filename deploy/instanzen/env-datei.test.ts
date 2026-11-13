import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envDateiWert, envSchreiben, envSetzen, envWert } from "./env-datei.ts";

describe("envWert liest wie Compose", () => {
  it.each([
    ["DOMAIN=a.example.de", "a.example.de"],
    ["DOMAIN=a.example.de # Firma 1", "a.example.de"],
    ["DOMAIN=a.example.de\t# Firma 1", "a.example.de"],
    ["DOMAIN=a#b", "a#b"],
    ['DOMAIN="a.example.de" # Kommentar', "a.example.de"],
    ["DOMAIN='a $x #y'", "a $x #y"],
    ['DOMAIN="a \\"b\\""', 'a "b"'],
    ["export DOMAIN=a.example.de", "a.example.de"],
    ["  DOMAIN = a.example.de  ", "a.example.de"],
    ["DOMAIN=", ""],
  ])("%s → %s", (zeile, wert) => {
    expect(envWert(`# Kommentar\n${zeile}\n`, "DOMAIN")).toBe(wert);
  });

  it("nimmt den letzten Eintrag und überliest auskommentierte", () => {
    expect(envWert("# DOMAIN=alt\nDOMAIN=a\nDOMAIN=b\n", "DOMAIN")).toBe("b");
    expect(envWert("# DOMAIN=alt\n", "DOMAIN")).toBeUndefined();
    expect(envWert("DOMAIN=a\r\nX=1\r\n", "DOMAIN")).toBe("a");
  });

  it("liefert ohne Datei undefined", async () => {
    expect(await envDateiWert("/gibt/es/nicht/.env", "DOMAIN")).toBeUndefined();
  });
});

describe("envSetzen", () => {
  it("ersetzt die aktive Zeile, sonst das auskommentierte Beispiel, sonst hängt es an", () => {
    expect(envSetzen("# DOMAIN=beispiel\nDOMAIN=alt\n", "DOMAIN", "neu.de")).toBe("# DOMAIN=beispiel\nDOMAIN=neu.de\n");
    expect(envSetzen("A=1\n# OIDC_ONLY=false\nB=2\n", "OIDC_ONLY", "true")).toBe("A=1\nOIDC_ONLY=true\nB=2\n");
    expect(envSetzen("A=1\n", "B", "2")).toBe("A=1\nB=2\n");
    expect(envSetzen("A=1", "B", "2")).toBe("A=1\nB=2\n");
  });

  it("setzt wörtliche Werte in einfache Anführungszeichen und lehnt ' und Zeilenumbrüche ab", () => {
    const text = envSetzen("", "OIDC_CLIENT_SECRET", "ge$heim #1", true);
    expect(text).toBe("OIDC_CLIENT_SECRET='ge$heim #1'\n");
    expect(envWert(text, "OIDC_CLIENT_SECRET")).toBe("ge$heim #1");
    expect(() => envSetzen("", "X", "it's", true)).toThrow();
    expect(() => envSetzen("", "X", "a\nB=1", true)).toThrow();
  });

  it("schreibt unsichere Werte nicht ohne Anführungszeichen", () => {
    expect(() => envSetzen("", "X", "a b")).toThrow();
    expect(() => envSetzen("", "X", "$HOME")).toThrow();
    expect(envSetzen("", "X", "abc+/=")).toBe("X=abc+/=\n");
  });
});

it("envSchreiben legt die Datei mit Rechten 600 an", async () => {
  const dir = mkdtempSync(join(tmpdir(), "haben-env-"));
  try {
    await envSchreiben(join(dir, ".env"), "A=1\n");
    expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
