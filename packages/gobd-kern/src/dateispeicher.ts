import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface DateispeicherOptionen {
  /** Wurzel des Speichers; als Funktion, damit sie erst beim Zugriff gelesen wird (etwa aus der Umgebung) */
  verzeichnis: () => string;
  /** Wort für eine Datei in Fehlermeldungen, etwa „Belegdatei“ */
  bezeichnung?: string;
}

export interface Dateispeicher {
  /** Pfad der Datei zu einem Hash: <verzeichnis>/ab/abcdef… */
  pfad(sha256: string): string;
  /** Speichert die Datei und gibt ihren SHA-256 zurück */
  speichern(bytes: Uint8Array): Promise<string>;
  /** Liest die Datei und prüft ihren Hash; eine veränderte Datei wirft einen Fehler */
  laden(sha256: string): Promise<Buffer>;
  /**
   * Prüft die Datei gegen ihren Hash, ohne sie ganz in den Speicher zu laden. Andere Lesefehler als eine fehlende Datei,
   * etwa fehlende Rechte, wirft sie.
   */
  pruefen(sha256: string): Promise<"ok" | "fehlt" | "beschädigt">;
  entfernen(sha256: string): Promise<void>;
}

/**
 * Dateien liegen unveränderlich unter ihrem SHA-256. Gleicher Inhalt ergibt dieselbe Datei, eine Änderung fällt beim
 * Lesen auf, und der Hash im Export belegt den Inhalt.
 */
export function dateispeicher({ verzeichnis, bezeichnung = "Datei" }: DateispeicherOptionen): Dateispeicher {
  function pfad(sha256: string): string {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("Ungültiger Hash");
    return join(resolve(verzeichnis()), sha256.slice(0, 2), sha256);
  }

  /**
   * Schreibt die Datei, falls sie noch nicht (unbeschädigt) liegt; atomar über eine temporäre Datei,
   * mit fsync, damit nach einem Absturz keine leere Datei unter dem Hash liegt.
   */
  async function speichern(bytes: Uint8Array): Promise<string> {
    const sha256 = sha256Of(bytes);
    const target = pfad(sha256);
    const intact = await readFile(target).then(
      (existing) => sha256Of(existing) === sha256,
      () => false,
    );
    if (!intact) {
      const dir = dirname(target);
      await mkdir(dir, { recursive: true });
      const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
      const file = await open(tmp, "w", 0o640);
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(tmp, target);
      // fsync auf einen Ordner lehnt Windows ab (EPERM); dort entfällt dieser Schritt (nur für die Entwicklung unter Windows)
      if (process.platform === "win32") return sha256;
      const folder = await open(dir, "r");
      try {
        await folder.sync();
      } finally {
        await folder.close();
      }
    }
    return sha256;
  }

  async function laden(sha256: string): Promise<Buffer> {
    const bytes = await readFile(pfad(sha256));
    if (sha256Of(bytes) !== sha256) throw new Error(`${bezeichnung} ${sha256} ist beschädigt`);
    return bytes;
  }

  async function pruefen(sha256: string): Promise<"ok" | "fehlt" | "beschädigt"> {
    const hash = createHash("sha256");
    try {
      for await (const chunk of createReadStream(pfad(sha256))) hash.update(chunk as Buffer);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "fehlt";
      throw error;
    }
    return hash.digest("hex") === sha256 ? "ok" : "beschädigt";
  }

  async function entfernen(sha256: string): Promise<void> {
    await rm(pfad(sha256), { force: true });
  }

  return { pfad, speichern, laden, pruefen, entfernen };
}
