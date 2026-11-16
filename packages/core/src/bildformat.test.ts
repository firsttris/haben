import { describe, expect, it } from "vitest";
import { bildFormat, MAX_LOGO_BYTES } from "./bildformat.ts";

describe("bildFormat", () => {
  it("erkennt PNG und JPEG an der Signatur", () => {
    expect(bildFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(bildFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
  });

  it("lehnt SVG, leere und zu kurze Dateien ab", () => {
    expect(bildFormat(new TextEncoder().encode("<svg xmlns="))).toBeNull();
    expect(bildFormat(new Uint8Array())).toBeNull();
    // Die Signatur allein genügt nicht: PNG braucht mehr als 8, JPEG mehr als 3 Byte
    expect(bildFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(bildFormat(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it("verlangt für PNG die volle Signatur aus 8 Byte", () => {
    expect(bildFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0]))).toBeNull();
    for (let i = 4; i < 8; i++) {
      const daten = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
      daten[i] = 0;
      expect(bildFormat(daten)).toBeNull();
    }
  });

  it("begrenzt Logos auf 1 MB", () => {
    expect(MAX_LOGO_BYTES).toBe(1024 * 1024);
  });
});
