import { DEFAULT_LAYOUT, designWithDefaults, LAYOUT_DOCUMENT_TYPES, type LayoutAssignment, letterheadDesignInputSchema } from "@haben/core";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Tx } from "../../db/index.ts";
import { geprueft, mitBezeichnung } from "../../errors.ts";
import { putBackground } from "./background.ts";
import { artFor, insertImportedLayout, type LayoutArt } from "./layouts.ts";
import { putLogo } from "./logo.ts";
import { genannt, UebernahmeError } from "./uebernahme.ts";

/*
 * Beleggestaltung aus der Einstellungsdatei einer anderen Instanz (#488): Logo und Briefpapier mit den Prüfungen des
 * Hochladens, eigene Layouts mit ihrer ID und das Standardprofil mit seinen Zuordnungen. Logo und Briefpapier kommen als
 * Bytes, deren SHA-256 modules/instanzwechsel schon geprüft hat.
 */

const layoutSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  art: z.enum(["beleg", "mahnung"]),
  source: z.string(),
  schemaVersion: z.number().int(),
  packages: z.array(z.object({ name: z.string().max(200), version: z.string().max(40) })).max(100),
});

const refSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("eingebaut"), id: z.string() }),
  z.object({ kind: z.literal("eigen"), id: z.uuid() }),
]);

const profilSchema = z.object({
  name: z.string().trim().max(60),
  isDefault: z.boolean(),
  settings: z.looseObject({ layouts: z.partialRecord(z.enum(LAYOUT_DOCUMENT_TYPES), refSchema).default({}) }),
});

export interface Gestaltung {
  profiles: readonly unknown[];
  logo: Uint8Array | null;
  background: Uint8Array | null;
  layouts: readonly unknown[];
}

export async function gestaltungUebernehmen(tx: Tx, gestaltung: Gestaltung): Promise<void> {
  const { logo, background } = gestaltung;
  if (logo) await mitBezeichnung("Logo", () => putLogo(tx, logo));
  if (background) await mitBezeichnung("Briefpapier", () => putBackground(tx, background));
  const arten = new Map<string, LayoutArt>();
  for (const raw of gestaltung.layouts) {
    const bezeichnung = `Layout ${genannt(raw, "name")}`;
    const layout = geprueft(layoutSchema, raw, bezeichnung);
    await mitBezeichnung(bezeichnung, () => insertImportedLayout(tx, layout));
    arten.set(layout.id, layout.art);
  }
  // Heute gibt es genau ein Profil, das Standardprofil; weitere Profile kommen mit #245 und einer neuen Formatversion
  const standard = gestaltung.profiles.find((profil) => (profil as { isDefault?: unknown } | null)?.isDefault === true);
  if (standard) await standardprofilUebernehmen(tx, standard, arten);
}

async function standardprofilUebernehmen(tx: Tx, raw: unknown, arten: ReadonlyMap<string, LayoutArt>): Promise<void> {
  const profil = geprueft(profilSchema, raw, "Beleggestaltung");
  const optionen = geprueft(letterheadDesignInputSchema, profil.settings, "Beleggestaltung");
  const layouts: Partial<LayoutAssignment> = {};
  for (const type of LAYOUT_DOCUMENT_TYPES) {
    const ref = profil.settings.layouts[type];
    if (!ref) continue;
    // Wie assignLayout: nur das eingebaute Layout oder ein eigenes der passenden Art aus derselben Datei
    if (ref.kind === "eingebaut" && ref.id !== DEFAULT_LAYOUT.id)
      throw new UebernahmeError(`Beleggestaltung: Das eingebaute Layout „${ref.id}“ gibt es nicht.`);
    if (ref.kind === "eigen" && arten.get(ref.id) !== artFor(type))
      throw new UebernahmeError(`Beleggestaltung: Das Layout für ${type} fehlt in der Datei oder passt nicht zur Belegart.`);
    layouts[type] = ref;
  }
  const changes = optionen.accent ? { ...optionen, accent: optionen.accent.toUpperCase() } : optionen;
  const settings = designWithDefaults({ ...changes, layouts: { ...designWithDefaults(null).layouts, ...layouts } });
  const profiles = schema.letterheadProfiles;
  await tx
    .insert(profiles)
    .values({ name: profil.name || "Standard", isDefault: true, settings })
    .onConflictDoUpdate({ target: profiles.isDefault, targetWhere: sql`${profiles.isDefault}`, set: { settings, updatedAt: new Date() } });
}
