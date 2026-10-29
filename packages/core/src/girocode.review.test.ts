import { describe, expect, it } from "vitest";
import { girocodePayload } from "./girocode.ts";

describe("Review girocodePayload", () => {
  it("IBAN mit falscher Prüfziffer ergibt keinen Code", () => {
    // DE89370400440532013000 ist gültig; Zahlendreher in der Kontonummer
    expect(girocodePayload({ name: "Max", iban: "DE89370400440532013001", amount: 100, text: "x" })).toBeNull();
  });
});
