import { UserError } from "./errors.ts";
import { logoFormat, type Logo } from "@haben/einvoice";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";

/** Firmenlogo für den Briefkopf von Rechnungen, Angeboten und Mahnungen */

export class LogoError extends UserError {}

export const MAX_LOGO_BYTES = 1024 * 1024;

export async function loadLogo(): Promise<Logo | undefined> {
  const [row] = await db.select({ logo: schema.companyLogo.logo, format: schema.companyLogo.format }).from(schema.companyLogo);
  return row ? { data: new Uint8Array(row.logo), format: row.format } : undefined;
}

export async function logoInfo(): Promise<{ format: "png" | "jpg"; sha256: string; createdAt: Date } | null> {
  const [row] = await db
    .select({ format: schema.companyLogo.format, sha256: schema.companyLogo.sha256, createdAt: schema.companyLogo.createdAt })
    .from(schema.companyLogo);
  return row ?? null;
}

export async function saveLogo(actor: string, data: Uint8Array): Promise<void> {
  if (data.length === 0) throw new LogoError("Die Datei ist leer.");
  if (data.length > MAX_LOGO_BYTES) throw new LogoError("Das Logo darf höchstens 1 MB groß sein.");
  const format = logoFormat(data);
  if (!format) throw new LogoError("Als Logo gehen PNG und JPEG.");
  const values = { logo: Buffer.from(data), format, sha256: createHash("sha256").update(data).digest("hex"), createdAt: new Date() };
  await withActor(actor, (tx) =>
    tx
      .insert(schema.companyLogo)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: schema.companyLogo.id, set: values }),
  );
}

export async function removeLogo(actor: string): Promise<void> {
  await withActor(actor, (tx) => tx.delete(schema.companyLogo).where(eq(schema.companyLogo.id, 1)));
}
