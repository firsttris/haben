import { describe, expect, it } from "vitest";
import { encodeCp1252 } from "./datev-export.ts";

describe("encodeCp1252 (Review)", () => {
  it("kodiert alle in Windows-1252 darstellbaren Zeichen, nicht nur eine Auswahl", () => {
    // Bytes laut Windows-1252-Tabelle; ein TextDecoder dekodiert 0x80–0x9F nicht in jeder Node-Version richtig
    expect([...encodeCp1252("•™ŠšŽžŒœŸ‰†‡‹›ƒˆ˜")]).toEqual([
      0x95, 0x99, 0x8a, 0x9a, 0x8e, 0x9e, 0x8c, 0x9c, 0x9f, 0x89, 0x86, 0x87, 0x8b, 0x9b, 0x83, 0x88, 0x98,
    ]);
  });
});
