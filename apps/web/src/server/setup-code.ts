import { count } from "drizzle-orm";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { db, schema } from "./db/index.ts";
import { env } from "./env.ts";

/** Ohne Doppeldeutiges wie 0/O und 1/I */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Prozessweit statt je Modul: im Build bringen Nitro-Plugin und SSR-Bundle je eine eigene Kopie dieser Datei mit */
const GENERATED = Symbol.for("haben.setupCode");
const store = globalThis as { [GENERATED]?: string };

/**
 * Code für die Ersteinrichtung. Ohne ihn könnte jeder, der eine frisch gestartete Instanz zuerst
 * erreicht, das einzige Konto anlegen. Er kommt aus HABEN_SETUP_CODE oder wird beim Start erzeugt
 * und ins Server-Log geschrieben.
 */
export function setupCode(): string {
  const configured = env().HABEN_SETUP_CODE;
  if (configured) return configured;
  store[GENERATED] ??= Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")).join("-");
  return store[GENERATED];
}

const normalize = (code: string) => code.replace(/[\s-]/g, "").toUpperCase();
const digest = (code: string) => createHash("sha256").update(normalize(code)).digest();

export function checkSetupCode(given: string | null | undefined): boolean {
  return !!given && timingSafeEqual(digest(given), digest(setupCode()));
}

/** Schreibt den Code ins Log, solange es noch kein Konto gibt */
export async function announceSetupCode(): Promise<void> {
  const [row] = await db.select({ n: count() }).from(schema.user);
  if ((row?.n ?? 0) > 0) return;
  const source = env().HABEN_SETUP_CODE ? "aus HABEN_SETUP_CODE" : setupCode();
  console.log(`Haben ist noch nicht eingerichtet. Einrichtungscode für ${env().BETTER_AUTH_URL}/setup: ${source}`);
}
