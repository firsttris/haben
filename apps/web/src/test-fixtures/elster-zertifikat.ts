import { readFileSync } from "node:fs";

// Erfundene Zertifikatsdateien für das Ablaufdatum (#1366), erzeugt mit elster-zertifikat/erzeugen.sh

/** PIN aller Testdateien */
export const TEST_PIN = "Erika 1366!";
/** notAfter des Zertifikats zum Schlüssel ist der 31.12.2029, 23:30 UTC: in Deutschland schon der 1.1.2030 */
export const TEST_GUELTIG_BIS = "2030-01-01";
/** notAfter der Zertifizierungsstelle in derselben Datei, früher als das Zertifikat */
export const TEST_CA_GUELTIG_BIS = "2028-06-30";

/** rc2-40 hat den Aufbau einer Datei aus Mein ELSTER von 2024 (Zertifikate RC2-40, Schlüssel 3DES, MAC SHA-1) */
export type Testdatei = "rc2-40" | "rc2-128" | "3des" | "aes" | "ohne-verschluesselung" | "zu-viele-iterationen";

export function testZertifikatsdatei(name: Testdatei): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./elster-zertifikat/${name}.pfx`, import.meta.url)));
}

/** Zertifikat zum Schlüssel oder das der Zertifizierungsstelle als PEM */
export function testZertifikatPem(name: "zertifikat" | "ca"): string {
  return readFileSync(new URL(`./elster-zertifikat/${name}.pem`, import.meta.url), "utf8");
}
