import { designWithDefaults, letterheadDesignInputSchema, type LetterheadDesign, type LetterheadDesignInput } from "@haben/core";
import type { Letterhead } from "@haben/einvoice";
import { eq, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { loadLogo } from "./logo.ts";

/** Briefkopf von Rechnungen, Angeboten und Mahnungen: Gestaltung aus dem Standardprofil, dazu das Logo */

export class AccentColorError extends UserError {}

/** Ohne gespeichertes Profil gelten die Vorgaben; Einstellungen, die eine ältere Zeile nicht kennt, ebenso */
export async function loadDesign(q: Db | Tx = db): Promise<LetterheadDesign> {
  const profiles = schema.letterheadProfiles;
  const [row] = await q.select({ settings: profiles.settings }).from(profiles).where(eq(profiles.isDefault, true));
  return designWithDefaults(row?.settings);
}

/** Heutige Gestaltung für jedes neu erzeugte PDF, auch für Mahnung und Lieferschein zu älteren Belegen; schon festgeschriebene PDFs bleiben */
export async function loadLetterhead(): Promise<Letterhead> {
  const [logo, design] = await Promise.all([loadLogo(), loadDesign()]);
  const { accent, logoSize, logoPosition, foldMarks, giroCode, customerNumber, vatColumn } = design;
  return { accent, options: { logoSize, logoPosition, foldMarks, giroCode, customerNumber, vatColumn }, ...(logo ? { logo } : {}) };
}

/** Ändert das Standardprofil; was die Eingabe nicht nennt, bleibt. Farben werden groß geschrieben gespeichert */
export async function saveDesign(actor: string, input: LetterheadDesignInput): Promise<LetterheadDesign> {
  const parsed = letterheadDesignInputSchema.safeParse(input);
  if (!parsed.success) throw new AccentColorError("Die Gestaltung ist ungültig. Die Akzentfarbe hat die Form #RRGGBB, z. B. #1F6F5C.");
  return withActor(actor, async (tx) => {
    const changes = parsed.data.accent ? { ...parsed.data, accent: parsed.data.accent.toUpperCase() } : parsed.data;
    const profiles = schema.letterheadProfiles;
    // In der Datenbank zusammenführen: Lesen und danach Schreiben ließe zwei gleichzeitige Änderungen sich überschreiben
    const [row] = await tx
      .insert(profiles)
      .values({ name: "Standard", isDefault: true, settings: designWithDefaults(changes) })
      .onConflictDoUpdate({
        target: profiles.isDefault,
        targetWhere: sql`${profiles.isDefault}`,
        set: { settings: sql`letterhead_profiles.settings || ${JSON.stringify(changes)}::jsonb`, updatedAt: new Date() },
      })
      .returning({ settings: profiles.settings });
    return designWithDefaults(row?.settings);
  });
}

export async function saveAccentColor(actor: string, color: string): Promise<void> {
  await saveDesign(actor, { accent: color });
}
