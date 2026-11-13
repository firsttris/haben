import { expect, it } from "vitest";
import { zeileAusBytes } from "./eingabe.ts";

/** Liefert die Bytes eines Textes einzeln, danach das Ende */
function tasten(text: string | number[]): () => number | null {
  const bytes = typeof text === "string" ? [...Buffer.from(text, "utf8")] : text;
  let i = 0;
  return () => bytes[i++] ?? null;
}

it("liest bis Enter und lässt den Rest liegen", () => {
  expect(zeileAusBytes(tasten("ge$heim #1\rrest"))).toBe("ge$heim #1");
  expect(zeileAusBytes(tasten("geheim\n"))).toBe("geheim");
});

it("endet auch bei Strg+D und am Ende der Eingabe", () => {
  expect(zeileAusBytes(tasten([0x61, 0x04, 0x62]))).toBe("a");
  expect(zeileAusBytes(tasten("ohne-enter"))).toBe("ohne-enter");
});

it("Rücktaste löscht ein ganzes Zeichen, auch mit Umlaut, und am Anfang nichts", () => {
  expect(zeileAusBytes(tasten([0x7f, ...Buffer.from("abü"), 0x7f, 0x08, ...Buffer.from("c\r")]))).toBe("ac");
});

it("Strg+C bricht ab, ohne die Eingabe zu nennen", () => {
  expect(() => zeileAusBytes(tasten([...Buffer.from("geheim"), 0x03]))).toThrow("Abgebrochen.");
});
