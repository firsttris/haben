import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env.ts";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function key(): Buffer {
  return Buffer.from(env().HABEN_ENCRYPTION_KEY, "base64");
}

/** AES-256-GCM; Ergebnis: IV | Tag | Chiffrat */
export function encrypt(plain: Uint8Array): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decrypt(sealed: Uint8Array): Buffer {
  const buffer = Buffer.from(sealed);
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buffer.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]);
}
