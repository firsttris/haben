import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  TEST_CA_GUELTIG_BIS,
  TEST_GUELTIG_BIS,
  TEST_PIN,
  testZertifikatPem,
  testZertifikatsdatei,
  type Testdatei,
} from "../../../test-fixtures/elster-zertifikat.ts";
import { earliestExpiry, readCertificateExpiry } from "./certificate-expiry.ts";

const der = (name: "zertifikat" | "ca") => new Uint8Array(new X509Certificate(testZertifikatPem(name)).raw);

describe("Frühestes Ablaufdatum (#1366)", () => {
  it("nimmt das früheste Zertifikat, als Tag in Deutschland", () => {
    expect(earliestExpiry([der("zertifikat")])).toBe(TEST_GUELTIG_BIS);
    expect(earliestExpiry([der("zertifikat"), der("ca")])).toBe(TEST_CA_GUELTIG_BIS);
    expect(earliestExpiry([])).toBeNull();
  });
});

describe("Ablaufdatum aus der ELSTER-Zertifikatsdatei (#1366)", () => {
  // Jede Datei enthält auch die Zertifizierungsstelle, die früher abläuft; es zählt nur das Zertifikat zum Schlüssel
  it.each<Testdatei>(["rc2-40", "rc2-128", "3des", "aes", "ohne-verschluesselung"])("liest %s mit der PIN", async (name) => {
    expect(await readCertificateExpiry(testZertifikatsdatei(name), TEST_PIN)).toBe(TEST_GUELTIG_BIS);
  });

  it.each<Testdatei>(["rc2-40", "rc2-128", "3des", "aes"])("%s mit falscher PIN ergibt kein Datum und keinen Fehler", async (name) => {
    expect(await readCertificateExpiry(testZertifikatsdatei(name), "Erika 1366?")).toBeNull();
    expect(await readCertificateExpiry(testZertifikatsdatei(name), "")).toBeNull();
  });

  it("unverschlüsselte Zertifikate brauchen die PIN nicht", async () => {
    expect(await readCertificateExpiry(testZertifikatsdatei("ohne-verschluesselung"), "falsch")).toBe(TEST_GUELTIG_BIS);
  });

  it("rechnet nicht mehr als MAX_ITERATIONS Iterationen", async () => {
    expect(await readCertificateExpiry(testZertifikatsdatei("zu-viele-iterationen"), TEST_PIN)).toBeNull();
  });

  it("eine kaputte oder abgeschnittene Datei ergibt kein Datum", async () => {
    const datei = testZertifikatsdatei("rc2-40");
    expect(await readCertificateExpiry(new TextEncoder().encode("kein echtes Zertifikat"), TEST_PIN)).toBeNull();
    expect(await readCertificateExpiry(datei.subarray(0, datei.length - 100), TEST_PIN)).toBeNull();
    expect(await readCertificateExpiry(new Uint8Array(0), TEST_PIN)).toBeNull();
  });
});
