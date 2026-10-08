import { eq } from "drizzle-orm";
import { encrypt } from "./crypto.ts";
import { withActor } from "./db/actor.ts";
import { schema } from "./db/index.ts";

/** Neues ELSTER-Zertifikat verschlüsselt ablegen; es löst das bisher aktive ab. */
export async function saveCertificate(actor: string, file: { filename: string; bytes: Uint8Array; validUntil: string | null }): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx.update(schema.elsterCertificates).set({ active: false }).where(eq(schema.elsterCertificates.active, true));
    await tx.insert(schema.elsterCertificates).values({ filename: file.filename, ciphertext: encrypt(file.bytes), validUntil: file.validUntil });
  });
}

/** Aktives Zertifikat abschalten; es bleibt für das Protokoll gespeichert. */
export async function deactivateCertificate(actor: string): Promise<void> {
  await withActor(actor, (tx) => tx.update(schema.elsterCertificates).set({ active: false }).where(eq(schema.elsterCertificates.active, true)));
}
