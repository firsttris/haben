import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestPfxOptions {
  /** Laufzeit des Zertifikats zum Schlüssel */
  days?: number;
  /** Mit Zertifikat einer Zertifizierungsstelle in der Datei, die so viele Tage gilt */
  caDays?: number;
  /** Verschlüsselt mit 3DES und MAC mit SHA-1 wie ältere Werkzeuge, statt AES-256 (PBES2) */
  legacy?: boolean;
}

/**
 * Zertifikatsdatei (.pfx) für Tests, mit openssl erzeugt und mit der PIN verschlüsselt, samt notAfter des Zertifikats
 * zum Schlüssel; null, wenn openssl fehlt. Nichts davon liegt im Repository.
 */
export function makeTestPfx(pin: string, { days = 1095, caDays, legacy = false }: TestPfxOptions = {}): { pfx: Uint8Array; notAfter: Date } | null {
  const dir = mkdtempSync(join(tmpdir(), "haben-pfx-"));
  const file = (name: string) => join(dir, name);
  const openssl = (...args: string[]) => execFileSync("openssl", args, { stdio: "ignore" });
  const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"];
  try {
    if (caDays === undefined) {
      openssl("req", "-x509", ...ec, "-keyout", file("k.pem"), "-out", file("c.pem"), "-days", String(days), "-subj", "/CN=haben-test");
    } else {
      openssl("req", "-x509", ...ec, "-keyout", file("ca.key"), "-out", file("ca.pem"), "-days", String(caDays), "-subj", "/CN=haben-test-ca");
      openssl("req", ...ec, "-keyout", file("k.pem"), "-out", file("c.csr"), "-subj", "/CN=haben-test");
      const ca = ["-CA", file("ca.pem"), "-CAkey", file("ca.key"), "-set_serial", "2"];
      openssl("x509", "-req", "-in", file("c.csr"), ...ca, "-days", String(days), "-out", file("c.pem"));
    }
    const chain = caDays === undefined ? [] : ["-certfile", file("ca.pem")];
    const encryption = legacy ? ["-certpbe", "PBE-SHA1-3DES", "-keypbe", "PBE-SHA1-3DES", "-macalg", "sha1"] : [];
    openssl("pkcs12", "-export", "-inkey", file("k.pem"), "-in", file("c.pem"), ...chain, ...encryption, "-passout", `pass:${pin}`, "-out", file("t.pfx"));
    return { pfx: new Uint8Array(readFileSync(file("t.pfx"))), notAfter: new X509Certificate(readFileSync(file("c.pem"))).validToDate };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
