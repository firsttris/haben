import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Selbstsigniertes Zertifikat mit Schlüssel für Tests, erzeugt mit openssl; null, wenn openssl fehlt. Nichts davon liegt im Repository. */
export function makeTestCertificate(days = 30): { certificatePem: string; privateKeyPem: string } | null {
  const dir = mkdtempSync(join(tmpdir(), "haben-zertifikat-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(dir, "k.pem"),
        "-out",
        join(dir, "c.pem"),
        "-days",
        String(days),
        "-subj",
        "/CN=haben-test",
      ],
      {
        stdio: "ignore",
      },
    );
    return { certificatePem: readFileSync(join(dir, "c.pem"), "utf8"), privateKeyPem: readFileSync(join(dir, "k.pem"), "utf8") };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
