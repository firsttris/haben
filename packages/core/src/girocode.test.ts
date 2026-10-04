import { describe, expect, it } from "vitest";
import { girocodePayload } from "./girocode.ts";

describe("girocodePayload", () => {
  it("baut den EPC-QR-Text nach Version 002", () => {
    expect(girocodePayload({ name: "Max  Mustermann", iban: "DE89 3704 0044 0532 0130 00", bic: "cobadeffxxx", amount: 123_456, text: "Rechnung 2026-001" })).toBe(
      "BCD\n002\n1\nSCT\nCOBADEFFXXX\nMax Mustermann\nDE89370400440532013000\nEUR1234.56\n\n\nRechnung 2026-001",
    );
    expect(girocodePayload({ name: "Max", iban: "DE89370400440532013000", amount: 5, text: "" })).toContain("\n\nMax\nDE89370400440532013000\nEUR0.05\n");
  });

  it("lässt den Code weg, wenn etwas nicht passt", () => {
    const ok = { name: "Max", iban: "DE89370400440532013000", amount: 100, text: "x" };
    expect(girocodePayload({ ...ok, iban: "" })).toBeNull();
    expect(girocodePayload({ ...ok, bic: "XYZ" })).toBeNull();
    expect(girocodePayload({ ...ok, amount: 0 })).toBeNull();
    expect(girocodePayload({ ...ok, amount: -100 })).toBeNull();
    expect(girocodePayload({ ...ok, name: "x".repeat(71) })).toBeNull();
    expect(girocodePayload({ ...ok, text: "x".repeat(141) })).toBeNull();
  });
});
