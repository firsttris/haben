import { describe, expect, it } from "vitest";
import { HINWEIS_HEADER_MAX_BYTES, hinweisHeader } from "./download.ts";

/*
 * Codex-Review zu #789: Der Hinweis zum DATEV-Export steht im Header. nginx legt alle Antwort-Header in einen Puffer von
 * einer Speicherseite (proxy_buffer_size, 4 oder 8 KiB); passt er nicht, kommt statt der Datei ein 502. Der Header bleibt
 * deshalb klein, auch bei vielen Zusammenstößen.
 */
describe("Hinweis-Header", () => {
  const zeile = (i: number) =>
    `„RE.2026.${String(i).padStart(3, "0")}“ und „RE-2026-${String(i).padStart(3, "0")}“ stehen im Belegfeld 1 als „RE-2026-${String(i).padStart(3, "0")}“; DATEV kann ihre offenen Posten verwechseln.`;

  it("bleibt bei 30 Zusammenstößen unter der Grenze und nennt, wie viele fehlen", () => {
    const header = hinweisHeader(Array.from({ length: 30 }, (_, i) => zeile(i + 1)));
    expect(new TextEncoder().encode(header).length).toBeLessThanOrEqual(HINWEIS_HEADER_MAX_BYTES);
    expect(HINWEIS_HEADER_MAX_BYTES).toBeLessThanOrEqual(2048);
    const text = decodeURIComponent(header).split("\n");
    expect(text[0]).toBe(zeile(1));
    expect(text.at(-1)).toMatch(/^Und \d+ weitere\.$/);
    expect(text.length - 1 + Number(/\d+/.exec(text.at(-1)!)![0])).toBe(30);
  });

  it("kürzt auch eine einzelne lange Zeile", () => {
    const header = hinweisHeader([`${"„RE.1“, ".repeat(500)}stehen im Belegfeld 1 als „RE-1“.`]);
    expect(new TextEncoder().encode(header).length).toBeLessThanOrEqual(HINWEIS_HEADER_MAX_BYTES);
    expect(decodeURIComponent(header).endsWith("…")).toBe(true);
  });

  it("lässt wenige Zeilen unverändert", () => {
    expect(decodeURIComponent(hinweisHeader([zeile(1), zeile(2)]))).toBe(`${zeile(1)}\n${zeile(2)}`);
  });
});
