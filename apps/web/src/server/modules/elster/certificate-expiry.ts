import { spawn } from "node:child_process";
import { X509Certificate } from "node:crypto";
import type { Writable } from "node:stream";
import { germanDay } from "@haben/core";

/*
 * Ablaufdatum der ELSTER-Zertifikatsdatei (#1366). Die Zertifikate in der .pfx (PKCS#12) liegen mit der PIN verschlüsselt
 * (RFC 7292, Kap. 4.1: EncryptedData); ohne PIN ist ihr notAfter (RFC 5280, Kap. 4.1.2.5) nicht zu lesen. openssl
 * bekommt die Datei über stdin und die PIN über einen eigenen Kanal (fd 3), nie als Argument, denn Argumente stehen in
 * jeder Prozessliste. -clcerts nimmt nur die Zertifikate zu den Schlüsseln der Datei, nicht die einer
 * Zertifizierungsstelle. Fehlt openssl, passt die PIN nicht oder steht kein Zertifikat darin, gibt es kein Datum und
 * keinen Fehler: Hochgeladen wird trotzdem. Die PIN bleibt nirgends liegen.
 */

const TIMEOUT_MS = 10_000;
const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/** Der Tag in Deutschland (JJJJ-MM-TT), an dem das erste Zertifikat der Datei abläuft; null, wenn es nicht zu lesen ist */
export async function readCertificateExpiry(pfx: Uint8Array, pin: string): Promise<string | null> {
  const pem = await clientCertificates(pfx, pin);
  try {
    return pem === null ? null : earliestExpiry(pem);
  } catch {
    // Ausgabe, die kein Zertifikat ist
    return null;
  }
}

/** Frühestes notAfter der Zertifikate im PEM-Text als Tag in Deutschland; der Server läuft im Container in UTC */
export function earliestExpiry(pem: string): string | null {
  const ends = (pem.match(PEM_CERTIFICATE) ?? []).map((block) => new X509Certificate(block).validToDate.getTime());
  return ends.length === 0 ? null : germanDay(new Date(Math.min(...ends)));
}

/** Zertifikate der Datei als PEM-Text, null bei falscher PIN, kaputter Datei, ohne openssl oder nach Zeitüberschreitung */
function clientCertificates(pfx: Uint8Array, pin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("openssl", ["pkcs12", "-nokeys", "-clcerts", "-passin", "fd:3"], { stdio: ["pipe", "pipe", "ignore", "pipe"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    let out = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      out += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out : null);
    });
    // Beendet sich openssl vor dem Lesen (falsche Datei), scheitert das Schreiben; das Ergebnis sagt dann der Exit-Code
    const pinChannel = child.stdio[3] as Writable | null;
    pinChannel?.on("error", () => {});
    child.stdin?.on("error", () => {});
    pinChannel?.end(`${pin}\n`);
    child.stdin?.end(pfx);
  });
}
