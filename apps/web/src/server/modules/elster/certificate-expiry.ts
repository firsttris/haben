import { X509Certificate } from "node:crypto";
import { germanDay } from "@haben/core";
import { clientCertificates } from "./pkcs12.ts";

/*
 * Ablaufdatum der ELSTER-Zertifikatsdatei (#1366). Die Datei enthält ein Signatur- und ein Verschlüsselungszertifikat
 * (ERiC-Entwicklerhandbuch 44.3.6.0, Kap. 5.2.2.2), dazu die Kette der Zertifizierungsstelle; es zählt das früheste
 * notAfter (RFC 5280, Kap. 4.1.2.5) der Zertifikate zu den Schlüsseln. Die PIN dient nur diesem einen Lesevorgang und
 * bleibt nirgends liegen. Passt sie nicht oder ist die Datei nicht lesbar, gibt es kein Datum und keinen Fehler:
 * Hochgeladen wird trotzdem, das Datum trägt man dann von Hand ein.
 */

/** Der Tag in Deutschland (JJJJ-MM-TT), an dem das erste Zertifikat zu einem Schlüssel abläuft; null, wenn nicht lesbar */
export async function readCertificateExpiry(pfx: Uint8Array, pin: string): Promise<string | null> {
  try {
    return earliestExpiry(await clientCertificates(pfx, pin));
  } catch {
    return null;
  }
}

/** Frühestes notAfter als Tag in Deutschland; der Server läuft im Container in UTC */
export function earliestExpiry(certificates: Uint8Array[]): string | null {
  const ends = certificates.map((der) => new X509Certificate(der).validToDate.getTime());
  return ends.length === 0 ? null : germanDay(new Date(Math.min(...ends)));
}
