/**
 * Das Werkzeug prüft das Logo selbst (logoPruefen), weil es nichts aus packages/core importieren darf (es läuft ohne
 * bun install). Hier laufen dieselben Bytes durch logoPruefen und gegen bildFormat und MAX_LOGO_BYTES in @haben/core
 * (#1069): Was das Werkzeug als Logo annimmt, nimmt Haben an, und umgekehrt.
 */
import { describe, expect, it } from "vitest";
import { bildFormat, MAX_LOGO_BYTES } from "../../packages/core/src/bildformat.ts";
import { logoPruefen, sha256 } from "./portal-zeichen.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const mitKopf = (kopf: Uint8Array, laenge: number) => {
  const daten = new Uint8Array(laenge);
  daten.set(kopf);
  return daten;
};

const FAELLE: [string, Uint8Array][] = [
  ["PNG", PNG],
  ["JPEG", JPEG],
  ["SVG", new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")],
  ["leer", new Uint8Array()],
  ["PNG mit nur 4 Byte Kopf", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0])],
  ["PNG mit falschem Byte 5", PNG.map((b, i) => (i === 4 ? 0 : b))],
  ["PNG mit falschem Byte 8", PNG.map((b, i) => (i === 7 ? 0 : b))],
  ["PNG-Kopf ohne Inhalt", PNG.subarray(0, 8)],
  ["zu kurzes JPEG", JPEG.subarray(0, 3)],
  ["PNG an der Grenze", mitKopf(PNG, MAX_LOGO_BYTES)],
  ["PNG zu groß", mitKopf(PNG, MAX_LOGO_BYTES + 1)],
  ["JPEG zu groß", mitKopf(JPEG, MAX_LOGO_BYTES + 1)],
];

describe("logoPruefen gegen bildFormat und MAX_LOGO_BYTES aus @haben/core", () => {
  it.each(FAELLE)("nimmt an oder lehnt ab wie Haben: %s", (_name, daten) => {
    const format = daten.length > MAX_LOGO_BYTES ? null : bildFormat(daten);
    for (const erwartet of ["png", "jpg"] as const) {
      const grund = logoPruefen(daten, { format: erwartet, sha256: sha256(daten) });
      expect(grund === null).toBe(format === erwartet);
    }
  });

  it("meldet dieselbe Grenze von 1 MB", () => {
    expect(logoPruefen(mitKopf(PNG, MAX_LOGO_BYTES + 1), { format: "png", sha256: "" })).toBe("ist größer als 1 MB");
  });
});
