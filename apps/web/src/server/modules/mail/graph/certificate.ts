import { createPrivateKey, X509Certificate } from "node:crypto";
import { MailError } from "../errors.ts";

/**
 * Zertifikat für die Anmeldung der App bei Microsoft Entra ID: Der öffentliche Teil liegt in der App-Registrierung, der
 * private Schlüssel in Haben (verschlüsselt). Haben speichert den SHA-256-Fingerabdruck im Klartext, er ist kein Geheimnis.
 */
export function readCertificate(certificatePem: string, privateKeyPem: string): { thumbprint: string; privateKeyPem: string } {
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(certificatePem);
  } catch {
    throw new MailError("Das Zertifikat ist nicht lesbar. Erwartet wird eine PEM-Datei, die mit „-----BEGIN CERTIFICATE-----“ beginnt.");
  }
  let key: ReturnType<typeof createPrivateKey>;
  try {
    key = createPrivateKey(privateKeyPem);
  } catch {
    throw new MailError("Der private Schlüssel ist nicht lesbar. Erwartet wird eine PEM-Datei ohne Passwort („-----BEGIN PRIVATE KEY-----“).");
  }
  if (!certificate.checkPrivateKey(key)) throw new MailError("Der private Schlüssel gehört nicht zu diesem Zertifikat.");
  if (new Date(certificate.validTo).getTime() < Date.now()) throw new MailError("Das Zertifikat ist abgelaufen.");
  return {
    thumbprint: certificate.fingerprint256.replaceAll(":", "").toLowerCase(),
    privateKeyPem: key.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}
