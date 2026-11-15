/**
 * Der Caddy-Block einer Instanz steht dreimal: in deploy/compose.yml (eingebauter Caddy einer einzelnen Instanz), in
 * deploy/Caddyfile (Vorlage für einen eigenen Caddy) und in caddyBlock (gemeinsamer Caddy des Werkzeugs). Ändert sich
 * ein Header oder die Uploadgrenze nur an einer Stelle, liefen Einzel- und Mehrfachbetrieb ohne Meldung auseinander
 * (Hinweis im Issue #1013 aus dem Review von #548). compose.yml trägt den Block inline, weil man die Datei auch allein
 * in eine Oberfläche wie Coolify oder Portainer einfügt; deshalb ein Vergleich statt einer gemeinsamen Datei.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { caddyBlock } from "./proxy.ts";

const deploy = join(import.meta.dirname, "..");

/**
 * Der Block ohne das, was je Ort abweichen darf: die Domain in der ersten Zeile, das Ziel von reverse_proxy und die
 * Einrückung (Tabs im Caddyfile, Leerzeichen im YAML). Leere Zeilen zählen nicht.
 */
function inhalt(block: string): string[] {
  return block
    .split("\n")
    .map((z) => z.trim())
    .filter((z) => z !== "")
    .map((z, i) => (i === 0 ? z.replace(/^\S+ \{$/, "<domain> {") : z.replace(/^reverse_proxy \S+$/, "reverse_proxy <ziel>")));
}

/** Der Inhalt von configs.caddyfile.content: die Zeilen nach `content: |`, solange sie tiefer eingerückt sind */
const ausCompose = () => {
  const text = readFileSync(join(deploy, "compose.yml"), "utf8");
  const anfang = "\n  caddyfile:\n    content: |\n";
  expect(text).toContain(anfang);
  const zeilen = text.slice(text.indexOf(anfang) + anfang.length).split("\n");
  const ende = zeilen.findIndex((z) => z !== "" && !z.startsWith("      "));
  return zeilen.slice(0, ende).join("\n");
};

describe("Caddy-Block einer Instanz", () => {
  it("ist in caddyBlock derselbe wie in deploy/compose.yml", () => {
    expect(inhalt(caddyBlock("firma1.example.de", "firma1"))).toEqual(inhalt(ausCompose()));
  });

  it("ist in deploy/Caddyfile derselbe wie in deploy/compose.yml", () => {
    expect(inhalt(readFileSync(join(deploy, "Caddyfile"), "utf8"))).toEqual(inhalt(ausCompose()));
  });

  it("vergleicht wirklich etwas: Header, Uploadgrenze und Ziel stehen im Block", () => {
    const zeilen = inhalt(ausCompose());
    expect(zeilen[0]).toBe("<domain> {");
    expect(zeilen).toContain("X-Frame-Options SAMEORIGIN");
    expect(zeilen).toContain("max_size 250MB");
    expect(zeilen).toContain("reverse_proxy <ziel>");
  });

  it("setzt Domain und Ziel der Instanz ein", () => {
    const block = caddyBlock("firma1.example.de", "firma1");
    expect(block.startsWith("firma1.example.de {\n")).toBe(true);
    expect(block).toContain("\treverse_proxy haben-firma1:3000\n");
  });
});
