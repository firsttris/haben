import { germanDay } from "@haben/core";
import { describe, expect, it } from "vitest";
import { earliestExpiry, readCertificateExpiry } from "./certificate-expiry.ts";
import { makeTestPfx } from "./test-zertifikat.ts";

// Selbstsigniert für diesen Test (openssl req -not_after), nur öffentliche Zertifikate ohne Schlüssel
/** notAfter 2029-12-31 23:30:00 UTC, in Deutschland schon der 1. Januar 2030 */
const SILVESTER = `-----BEGIN CERTIFICATE-----
MIIBfzCCASWgAwIBAgIUB9pn/pa19pf7vzJ+weI+T60w8PQwCgYIKoZIzj0EAwIw
FTETMBEGA1UEAwwKaGFiZW4tdGVzdDAeFw0yNjExMTgwMDAwMDBaFw0yOTEyMzEy
MzMwMDBaMBUxEzARBgNVBAMMCmhhYmVuLXRlc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAATC82GOJSqb+PystQDGbaC7GdL/991l2AtweqYRx0fxg2/KUV2X+YF/
0lgAnCPUwxzBmr7JPEsOduViAzmwNgmPo1MwUTAdBgNVHQ4EFgQUxRUKHgztG1YK
YHWcbkNoE9AvpuIwHwYDVR0jBBgwFoAUxRUKHgztG1YKYHWcbkNoE9AvpuIwDwYD
VR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiAw/9kWJy4YRGjiP9zCOfRq
QOU+cAGYAVS1wDMM8R3ipgIhANStUyV84NWECAqyRWO6JMEkt3adEXH8L8ocA/xI
fyXD
-----END CERTIFICATE-----`;
/** notAfter 2030-06-15 12:00:00 UTC */
const SOMMER = `-----BEGIN CERTIFICATE-----
MIIBfjCCASWgAwIBAgIUSYIcBbS/sY05/xmcpjnniNDcaRIwCgYIKoZIzj0EAwIw
FTETMBEGA1UEAwwKaGFiZW4tdGVzdDAeFw0yNjExMTgwMDAwMDBaFw0zMDA2MTUx
MjAwMDBaMBUxEzARBgNVBAMMCmhhYmVuLXRlc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAAQmpmbYdtY5H5cC6fHFlFjOnd/VM9LtbE4CEMFD+G8tO7zj/QDn+Jyk
YCY9cGpqvwudEFRFuYY1lszHv89r9kKKo1MwUTAdBgNVHQ4EFgQUWqKyX8ro117p
EneWFZvBhcyZkkYwHwYDVR0jBBgwFoAUWqKyX8ro117pEneWFZvBhcyZkkYwDwYD
VR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNHADBEAiA8fg1RY7pCv6m6uUQOh7N7
PjDdS189OkjYSxpTWm2FKgIgWmqt/08FVF6G9R7VFsip9HPOqAbuiU7QpWs0sBmM
WF0=
-----END CERTIFICATE-----`;

describe("Frühestes Ablaufdatum aus der Ausgabe von openssl", () => {
  it("nimmt das früheste Zertifikat, als Tag in Deutschland", () => {
    // Zwischen den Blöcken stehen bei openssl die Bag Attributes
    expect(earliestExpiry(`Bag Attributes\n    localKeyID: 01\n${SOMMER}\nBag Attributes\n${SILVESTER}\n`)).toBe("2030-01-01");
    expect(earliestExpiry(SOMMER)).toBe("2030-06-15");
  });

  it("ohne Zertifikat kein Datum", () => {
    expect(earliestExpiry("")).toBeNull();
  });
});

const PIN = "123456";
const pfx = makeTestPfx(PIN);

describe("Ablaufdatum aus der ELSTER-Zertifikatsdatei (#1366)", () => {
  it.skipIf(!pfx)("liest notAfter mit der PIN", async () => {
    expect(await readCertificateExpiry(pfx!.pfx, PIN)).toBe(germanDay(pfx!.notAfter));
  });

  it.skipIf(!pfx)("mit falscher PIN oder kaputter Datei kein Datum und kein Fehler", async () => {
    expect(await readCertificateExpiry(pfx!.pfx, "654321")).toBeNull();
    expect(await readCertificateExpiry(new TextEncoder().encode("kein echtes Zertifikat"), PIN)).toBeNull();
  });

  const sonderzeichen = 'Ä ö $HOME "x" `id`';
  const mitSonderzeichen = makeTestPfx(sonderzeichen);
  it.skipIf(!mitSonderzeichen)("gibt die PIN unverändert weiter, auch mit Leerzeichen und Zeichen der Shell", async () => {
    expect(await readCertificateExpiry(mitSonderzeichen!.pfx, sonderzeichen)).toBe(germanDay(mitSonderzeichen!.notAfter));
  });

  // Die Zertifizierungsstelle läuft hier vor dem eigenen Zertifikat ab; es zählt nur das zum Schlüssel
  const mitCa = makeTestPfx(PIN, { days: 1095, caDays: 30 });
  it.skipIf(!mitCa)("nimmt das Zertifikat zum Schlüssel, nicht das der Zertifizierungsstelle", async () => {
    expect(await readCertificateExpiry(mitCa!.pfx, PIN)).toBe(germanDay(mitCa!.notAfter));
  });

  const legacy = makeTestPfx(PIN, { legacy: true });
  it.skipIf(!legacy)("liest auch Dateien mit 3DES und SHA-1 wie von älteren Werkzeugen", async () => {
    expect(await readCertificateExpiry(legacy!.pfx, PIN)).toBe(germanDay(legacy!.notAfter));
  });

  it("ohne openssl kein Datum und kein Fehler", async () => {
    const path = process.env.PATH;
    process.env.PATH = "/nicht-vorhanden";
    try {
      expect(await readCertificateExpiry(new Uint8Array([1, 2, 3]), PIN)).toBeNull();
    } finally {
      process.env.PATH = path;
    }
  });
});
