import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { decrypt, encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { PLATZHALTER } from "./senden.ts";

/*
 * Einstellung der Ablage: wohin Haben festgeschriebene Rechnungen schickt. Allgemein gehalten, ohne Produktnamen: Jedes
 * Archiv, das Dateien per multipart/form-data annimmt, lässt sich mit Feldname, Kopfzeile und Zusatzfeldern ansprechen.
 */

export class AblageError extends UserError {}

/** Name eines Formularfelds oder einer Kopfzeile: ein Token nach RFC 9110, Abschnitt 5.6.2 */
const TOKEN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** Kopfzeilen, die fetch selbst setzt oder die die Anfrage anders lenken würden */
const RESERVIERT = new Set(["host", "content-type", "content-length", "transfer-encoding", "connection", "cookie", "expect", "upgrade"]);

// biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen sind hier gesucht
const OHNE_STEUERZEICHEN = /^[^\u0000-\u001f\u007f]*$/;

const adresse = z
  .string()
  .trim()
  .min(1, "Adresse fehlt")
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && !url.hash;
    } catch {
      return false;
    }
  }, "Eine vollständige Adresse mit http:// oder https://, ohne Zugangsdaten und ohne #");

const feldname = z.string().trim().min(1, "Feldname fehlt").max(100).regex(TOKEN, "Feldname nur aus Buchstaben, Ziffern und - _ . ohne Leerzeichen");

export const archiveTargetSchema = z
  .object({
    url: adresse,
    fileField: feldname,
    /** leer: ohne Kopfzeile */
    headerName: z
      .string()
      .trim()
      .max(100)
      .regex(new RegExp(`^$|${TOKEN.source}`), "Name der Kopfzeile ohne Leerzeichen und Doppelpunkt, z. B. Authorization")
      .refine((name) => !RESERVIERT.has(name.toLowerCase()), "Diese Kopfzeile setzt Haben selbst"),
    /** leer: den gespeicherten Wert behalten */
    headerValue: z.string().max(4000).regex(OHNE_STEUERZEICHEN, "Wert der Kopfzeile in einer Zeile").optional(),
    fields: z
      .array(
        z.object({
          name: feldname,
          value: z.string().max(500).regex(OHNE_STEUERZEICHEN, "Wert in einer Zeile"),
        }),
      )
      .max(10),
    file: z.enum(["original", "pdf"]),
    linkTemplate: z
      .string()
      .trim()
      .max(2000)
      .refine(
        (value) => value === "" || (adresse.safeParse(value.replaceAll("{id}", "1")).success && value.includes("{id}")),
        "Link mit {id}, z. B. https://archiv.example/dokumente/{id}",
      ),
    enabled: z.boolean(),
  })
  .refine((input) => !input.fields.some((field) => field.name === input.fileField), { message: "Ein Zusatzfeld heißt wie das Dateifeld", path: ["fields"] })
  .refine((input) => new Set(input.fields.map((field) => field.name)).size === input.fields.length, {
    message: "Zwei Zusatzfelder heißen gleich",
    path: ["fields"],
  });

export type ArchiveTargetInput = z.input<typeof archiveTargetSchema>;
export type ArchiveTarget = typeof schema.archiveTarget.$inferSelect;

export async function loadArchiveTarget(): Promise<ArchiveTarget | null> {
  const [row] = await db.select().from(schema.archiveTarget).where(eq(schema.archiveTarget.id, 1));
  return row ?? null;
}

/** Kopfzeile mit Wert für die Anfrage; null ohne */
export function headerOf(target: ArchiveTarget): { name: string; value: string } | null {
  if (!target.headerName || !target.ciphertext) return null;
  return { name: target.headerName, value: new TextDecoder().decode(decrypt(target.ciphertext)) };
}

/** Für die Oberfläche: alles außer dem Wert der Kopfzeile */
export async function archiveTargetSummary() {
  const target = await loadArchiveTarget();
  if (!target) return { target: null, platzhalter: PLATZHALTER };
  const { ciphertext, ...rest } = target;
  return { target: { ...rest, headerSet: ciphertext !== null }, platzhalter: PLATZHALTER };
}

/**
 * Speichert das Ziel. Mit neuer Adresse beginnt `since` neu: Haben schickt nur, was ab dann festgeschrieben wird, nicht
 * den ganzen Bestand an eine Adresse, die ihn vielleicht nicht erwartet. Aus- und Wiedereinschalten lässt `since`
 * stehen, damit auch die Rechnungen aus der Pause ins Archiv gehen. Fehlversuche an die Adresse beginnen von vorn,
 * damit eine korrigierte Kopfzeile gleich wirkt.
 */
export async function saveArchiveTarget(actor: string, input: ArchiveTargetInput): Promise<void> {
  const { headerValue, linkTemplate, headerName, ...rest } = archiveTargetSchema.parse(input);
  const existing = await loadArchiveTarget();
  const keepValue = !headerValue && existing?.headerName && headerName;
  if (headerName && !headerValue && !keepValue) throw new AblageError("Wert der Kopfzeile fehlt.");
  const restart = !existing || existing.url !== rest.url;
  const values = {
    ...rest,
    headerName: headerName || null,
    ciphertext: !headerName ? null : headerValue ? encrypt(new TextEncoder().encode(headerValue)) : existing!.ciphertext,
    linkTemplate: linkTemplate || null,
    ...(restart ? { since: new Date() } : {}),
    updatedAt: new Date(),
  };
  await withActor(actor, async (tx) => {
    await tx
      .insert(schema.archiveTarget)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: schema.archiveTarget.id, set: values });
    await tx
      .update(schema.archiveDeliveries)
      .set({ attempts: 0 })
      .where(and(eq(schema.archiveDeliveries.url, rest.url), ne(schema.archiveDeliveries.status, "uebertragen")));
  });
}

/** Schickt nichts mehr; bisherige Weitergaben bleiben im Protokoll */
export async function deleteArchiveTarget(actor: string): Promise<void> {
  await withActor(actor, (tx) => tx.delete(schema.archiveTarget).where(eq(schema.archiveTarget.id, 1)));
}
