import { eq } from "drizzle-orm";
import { encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { schema } from "../../db/index.ts";
import { readCertificateExpiry } from "./certificate-expiry.ts";

export interface CertificateUpload {
  filename: string;
  bytes: Uint8Array;
  /** Von Hand eingetragen; gilt, wenn das Datum nicht aus der Datei zu lesen ist */
  validUntil: string | null;
  /** Nur zum Lesen des Ablaufdatums, wird nicht gespeichert (#1366) */
  pin: string;
}

/**
 * Neues ELSTER-Zertifikat verschlüsselt ablegen; es löst das bisher aktive ab. Mit PIN gilt das Ablaufdatum aus der
 * Datei, sonst das eingetragene.
 */
export async function saveCertificate(actor: string, file: CertificateUpload): Promise<{ validUntil: string | null; readFromFile: boolean }> {
  // Vor der Transaktion, damit keine Datenbankverbindung auf die Schlüsselableitung aus der PIN wartet
  const fromFile = file.pin ? await readCertificateExpiry(file.bytes, file.pin) : null;
  const validUntil = fromFile ?? file.validUntil;
  await withActor(actor, async (tx) => {
    await tx.update(schema.elsterCertificates).set({ active: false }).where(eq(schema.elsterCertificates.active, true));
    await tx.insert(schema.elsterCertificates).values({ filename: file.filename, ciphertext: encrypt(file.bytes), validUntil });
  });
  return { validUntil, readFromFile: fromFile !== null };
}

/** Aktives Zertifikat abschalten; es bleibt für das Protokoll gespeichert. */
export async function deactivateCertificate(actor: string): Promise<void> {
  await withActor(actor, (tx) => tx.update(schema.elsterCertificates).set({ active: false }).where(eq(schema.elsterCertificates.active, true)));
}
