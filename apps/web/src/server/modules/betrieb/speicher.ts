import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../../db/index.ts";

/** Gleichzeitige lstat-Aufrufe beim Zählen; genug für eine schnelle Platte, ohne die Dateideskriptoren auszuschöpfen */
const PARALLEL = 64;

/** Belegter Platz der Datenbank, wie Postgres ihn auf der Platte führt (Tabellen, Indizes, TOAST, ohne WAL) */
export async function datenbankBytes(): Promise<number> {
  const [zeile] = await db.execute<{ bytes: string }>(sql`select pg_database_size(current_database())::text as bytes`);
  return Number(zeile?.bytes ?? 0);
}

const fehlt = (error: unknown) => (error as { code?: unknown } | null)?.code === "ENOENT";

/**
 * Summe der Dateien unter einem Verzeichnis, mit allen Unterordnern (Belege unter ihrem SHA-256, Vorlagen und ihre
 * Pakete). Gezählt wird die Platte, nicht die Größen in der Datenbank: Eine Datei, die mehrere Belege teilen, liegt nur
 * einmal da, und Vorlagen stehen in keiner Tabelle mit Größe. Symlinks zählen nicht; ein fehlendes Verzeichnis oder eine
 * Datei, die während des Zählens verschwindet, zählt 0.
 */
export async function verzeichnisBytes(verzeichnis: string): Promise<number> {
  let summe = 0;
  const offen = [verzeichnis];
  while (offen.length > 0) {
    const dir = offen.pop() as string;
    let eintraege: Dirent[];
    try {
      eintraege = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (fehlt(error)) continue;
      throw error;
    }
    const dateien: string[] = [];
    for (const e of eintraege) {
      if (e.isDirectory()) offen.push(join(dir, e.name));
      else if (e.isFile()) dateien.push(join(dir, e.name));
    }
    for (let i = 0; i < dateien.length; i += PARALLEL) {
      const groessen = await Promise.all(
        dateien.slice(i, i + PARALLEL).map((pfad) =>
          lstat(pfad).then(
            (s) => s.size,
            (error: unknown) => {
              if (fehlt(error)) return 0;
              throw error;
            },
          ),
        ),
      );
      for (const g of groessen) summe += g;
    }
  }
  return summe;
}
