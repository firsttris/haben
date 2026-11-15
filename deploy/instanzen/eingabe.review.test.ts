/**
 * TDD-Review #548: Bei der verdeckten Eingabe sieht niemand, was im Secret landet. Im Rohmodus des Terminals kommen
 * Strg+U und Pfeiltasten als Bytes an, statt wie bei docker login oder psql vom Terminal behandelt zu werden.
 */
import { expect, it } from "vitest";
import { zeileAusBytes } from "./eingabe.ts";

function tasten(text: string): () => number | null {
  const bytes = [...Buffer.from(text, "utf8")];
  let i = 0;
  return () => bytes[i++] ?? null;
}

it("Strg+U verwirft die bisherige Eingabe, wie an jeder verdeckten Abfrage", () => {
  expect(zeileAusBytes(tasten("vertippt\x15ge$heim ü\r"))).toBe("ge$heim ü");
});

it("nimmt Pfeiltasten und andere Steuerzeichen nicht still ins Secret, liest die Zeile zu Ende und nennt die Eingabe nicht", () => {
  const rest = tasten("geheim\x1b[Dx\rrest");
  let meldung = "";
  try {
    zeileAusBytes(rest);
  } catch (error) {
    meldung = (error as Error).message;
  }
  expect(meldung).toContain("Steuerzeichen");
  expect(meldung).not.toContain("geheim");
  // Bis Enter gelesen: Der Rest der Tastenfolge landet nicht nach dem Abbruch in der Shell
  expect(String.fromCharCode(rest() ?? 0)).toBe("r");
  expect(() => zeileAusBytes(tasten("a\tb\r"))).toThrow("Steuerzeichen");
});
