import { embedsInPdf, logoFormat, type Logo } from "@haben/einvoice";
import { eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";

/** Briefpapier hinter den Belegen: ein Bild, das jedes neu erzeugte PDF einbettet, deshalb enger begrenzt als ein Anhang */

export class BackgroundError extends UserError {}

const run = promisify(execFile);

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

const isPdf = (data: Uint8Array): boolean => data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46;

/**
 * Erste Seite als Bild: Typst kann in PDF/A-3b kein PDF einbetten („embedding PDFs is currently not supported in this export
 * mode“). 200 dpi reichen für Bildschirm und Druck; pdftoppm läuft als eigener Prozess, ein beschädigtes PDF trifft den Server nicht.
 */
async function firstPageImage(pdf: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "haben-briefpapier-"));
  try {
    const input = join(dir, "briefpapier.pdf");
    await writeFile(input, pdf);
    await run("pdftoppm", ["-png", "-r", "200", "-singlefile", "-f", "1", "-l", "1", input, join(dir, "seite")], { timeout: 30_000 }).catch(
      (error: { code?: unknown }) => {
        throw new BackgroundError(
          error.code === "ENOENT"
            ? "PDFs lassen sich hier nicht umwandeln, weil pdftoppm fehlt. Bitte als PNG oder JPEG hochladen."
            : "Das PDF lässt sich nicht lesen. Bitte als PNG oder JPEG hochladen.",
        );
      },
    );
    return new Uint8Array(await readFile(join(dir, "seite.png")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function saveBackground(actor: string, upload: Uint8Array): Promise<void> {
  if (upload.length === 0) throw new BackgroundError("Die Datei ist leer.");
  if (upload.length > MAX_BACKGROUND_BYTES) throw new BackgroundError("Das Briefpapier darf höchstens 2 MB groß sein.");
  const data = isPdf(upload) ? await firstPageImage(upload) : upload;
  if (data.length > MAX_BACKGROUND_BYTES)
    throw new BackgroundError("Das Briefpapier darf höchstens 2 MB groß sein. Als Bild wird dieses PDF größer; bitte ein kleineres hochladen.");
  const format = logoFormat(data);
  if (!format) throw new BackgroundError("Als Briefpapier gehen PNG, JPEG und PDF.");
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
