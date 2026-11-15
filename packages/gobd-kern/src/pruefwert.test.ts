import { describe, expect, it } from "vitest";
import { formatPruefwert, parsePruefwert } from "./pruefwert.ts";

const hash = "ab".repeat(32);

describe("Prüfwert", () => {
  it("schreibt Nummer und Hash und liest sie zurück", () => {
    const text = formatPruefwert({ seq: 1234, hash });
    expect(text).toBe(`Nr. 1234 · ${hash}`);
    expect(parsePruefwert(text)).toEqual({ seq: 1234, hash });
  });

  it("liest tolerant: Zeilenumbrüche, Großbuchstaben, anderer Text davor", () => {
    expect(parsePruefwert(`Prüfwert: Nr. 7\n· ${hash.toUpperCase()}`)).toEqual({ seq: 7, hash });
  });

  it("gibt null zurück, wenn kein vollständiger Hash dasteht", () => {
    expect(parsePruefwert("Nr. 7 · abc")).toBeNull();
  });
});
