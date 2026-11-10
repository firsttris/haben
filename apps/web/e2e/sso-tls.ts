import { createHash, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Eigene lokale Test-CA: auch der Produktionsserver validiert TLS, ohne Sicherheitsausnahme in Haben. */
export function ssoTestTls() {
  const directory = join(tmpdir(), "haben-sso-e2e-tls");
  mkdirSync(directory, { recursive: true });
  const cert = join(directory, "localhost.crt");
  const key = join(directory, "localhost.key");
  if (!existsSync(cert))
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "2",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
  const publicKey = new X509Certificate(readFileSync(cert)).publicKey.export({ format: "der", type: "spki" });
  return { cert, key, spki: createHash("sha256").update(publicKey).digest("base64") };
}
