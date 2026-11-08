import { embedsInPdf, logoFormat, type Logo } from "@haben/einvoice";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";

/** Briefpapier hinter den Belegen: ein Bild, das jedes neu erzeugte PDF einbettet, deshalb enger begrenzt als ein Anhang */

export class BackgroundError extends UserError {}

export const MAX_BACKGROUND_BYTES = 2 * 1024 * 1024;

export async function loadBackground(): Promise<Logo | undefined> {
  const table = schema.letterheadBackground;
  const [row] = await db.select({ background: table.background, format: table.format }).from(table);
  return row ? { data: new Uint8Array(row.background), format: row.format } : undefined;
}

export async function backgroundInfo(): Promise<{ format: "png" | "jpg"; sha256: string; createdAt: Date } | null> {
  const table = schema.letterheadBackground;
  const [row] = await db.select({ format: table.format, sha256: table.sha256, createdAt: table.createdAt }).from(table);
  return row ?? null;
}

export async function saveBackground(actor: string, data: Uint8Array): Promise<void> {
  if (data.length === 0) throw new BackgroundError("Die Datei ist leer.");
  if (data.length > MAX_BACKGROUND_BYTES) throw new BackgroundError("Das Briefpapier darf höchstens 2 MB groß sein.");
  const format = logoFormat(data);
  if (!format) throw new BackgroundError("Als Briefpapier gehen PNG und JPEG.");
  if (!embedsInPdf({ data, format }))
    throw new BackgroundError("Das Bild lässt sich nicht in ein PDF einbetten. Die Datei ist beschädigt oder im Farbraum CMYK; bitte als RGB speichern.");
  const values = { background: Buffer.from(data), format, sha256: createHash("sha256").update(data).digest("hex"), createdAt: new Date() };
  await withActor(actor, (tx) =>
    tx
      .insert(schema.letterheadBackground)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: schema.letterheadBackground.id, set: values }),
  );
}

export async function removeBackground(actor: string): Promise<void> {
  await withActor(actor, (tx) => tx.delete(schema.letterheadBackground).where(eq(schema.letterheadBackground.id, 1)));
}
