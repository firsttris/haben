import { describe, expect, it } from "vitest";
import { rc2CbcDecrypt, rc2DecryptBlock } from "./rc2.ts";

const hex = (s: string) => Uint8Array.from(Buffer.from(s.replace(/\s/g, ""), "hex"));

// RFC 2268, Kap. 5 (Verschlüsselung); hier rückwärts: der Geheimtext ergibt den Klartext
const VEKTOREN = [
  { bytes: 8, bits: 63, key: "00000000 00000000", plain: "00000000 00000000", cipher: "ebb773f9 93278eff" },
  { bytes: 8, bits: 64, key: "ffffffff ffffffff", plain: "ffffffff ffffffff", cipher: "278b27e4 2e2f0d49" },
  { bytes: 8, bits: 64, key: "30000000 00000000", plain: "10000000 00000001", cipher: "30649edf 9be7d2c2" },
  { bytes: 1, bits: 64, key: "88", plain: "00000000 00000000", cipher: "61a8a244 adacccf0" },
  { bytes: 7, bits: 64, key: "88bca90e 90875a", plain: "00000000 00000000", cipher: "6ccf4308 974c267f" },
  { bytes: 16, bits: 64, key: "88bca90e 90875a7f 0f79c384 627bafb2", plain: "00000000 00000000", cipher: "1a807d27 2bbe5db1" },
  { bytes: 16, bits: 128, key: "88bca90e 90875a7f 0f79c384 627bafb2", plain: "00000000 00000000", cipher: "2269552a b0f85ca6" },
  {
    bytes: 33,
    bits: 129,
    key: "88bca90e 90875a7f 0f79c384 627bafb2 16f80a6f 85920584 c42fceb0 be255daf 1e",
    plain: "00000000 00000000",
    cipher: "5b78d3a4 3dfff1f1",
  },
];

describe("RC2 nach RFC 2268 (#1366)", () => {
  it.each(VEKTOREN)("Testvektor mit $bytes Bytes Schlüssel und $bits Bit wirksamer Länge", ({ bytes, bits, key, plain, cipher }) => {
    expect(hex(key)).toHaveLength(bytes);
    expect(Buffer.from(rc2DecryptBlock(hex(key), bits, hex(cipher))).toString("hex")).toBe(plain.replace(/\s/g, ""));
  });

  it("CBC: Länge oder Padding falsch ergibt null statt Daten", () => {
    const key = hex("0102030405");
    const iv = new Uint8Array(8);
    expect(rc2CbcDecrypt(key, 40, iv, new Uint8Array(0))).toBeNull();
    expect(rc2CbcDecrypt(key, 40, iv, new Uint8Array(12))).toBeNull();
    expect(rc2CbcDecrypt(key, 40, new Uint8Array(4), new Uint8Array(8))).toBeNull();
    // Ein Block, dessen Klartext nicht mit gültigem Padding endet
    expect(rc2CbcDecrypt(key, 40, iv, hex("0000000000000000"))).toBeNull();
  });
});
