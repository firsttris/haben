import { createHash } from "node:crypto";
import { DEFAULT_LAYOUT, type LayoutDocumentType, type LayoutRef } from "@haben/core";
import { LAYOUT_SCHEMA_VERSION, type Letterhead, type PdfRequest } from "@haben/einvoice";
import { asc, eq, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { checkLayout, LayoutError, MAX_LAYOUT_BYTES, packagesIn, typstMeldung } from "./layout-pruefung.ts";
import { customLayoutJob, dataForVersion, layoutRenderer } from "./layout-renderer.ts";
import { loadDesign } from "./letterhead.ts";

/*
 * Eigene Belegvorlagen (#113): hochladen, benennen, löschen und je Belegart zuordnen. Ein Layout gilt für alles, was ab
 * dann erzeugt wird; festgeschriebene Belege behalten ihr PDF. Scheitert ein Layout beim Erzeugen, meldet Haben das und
 * fällt nicht still auf das eingebaute zurück.
 */

export { LayoutError, MAX_LAYOUT_BYTES };

export type LayoutArt = "beleg" | "mahnung";

/** Mahnungen haben eigene Felder; alle anderen Belegarten setzt dieselbe Art Vorlage */
export const artFor = (type: LayoutDocumentType): LayoutArt => (type === "mahnung" ? "mahnung" : "beleg");

const columns = {
  id: schema.belegLayouts.id,
  name: schema.belegLayouts.name,
  art: schema.belegLayouts.art,
  schemaVersion: schema.belegLayouts.schemaVersion,
  packages: schema.belegLayouts.packages,
  sha256: schema.belegLayouts.sha256,
  updatedAt: schema.belegLayouts.updatedAt,
};

export async function listLayouts() {
  return db.select(columns).from(schema.belegLayouts).orderBy(asc(schema.belegLayouts.name));
}

export async function layoutSource(id: string): Promise<{ name: string; source: string } | null> {
  const [row] = await db
    .select({ name: schema.belegLayouts.name, source: schema.belegLayouts.source })
    .from(schema.belegLayouts)
    .where(eq(schema.belegLayouts.id, id));
  return row ?? null;
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60) throw new LayoutError("Der Name des Layouts hat 1 bis 60 Zeichen.");
  return trimmed;
}

async function nameTaken(name: string, except?: string): Promise<boolean> {
  const rows = await db.select({ id: schema.belegLayouts.id }).from(schema.belegLayouts).where(eq(schema.belegLayouts.name, name));
  return rows.some((row) => row.id !== except);
}

function checkSource(source: string) {
  if (!source.trim()) throw new LayoutError("Die Datei ist leer.");
  if (Buffer.byteLength(source, "utf8") > MAX_LAYOUT_BYTES) throw new LayoutError("Ein Layout darf höchstens 256 KB groß sein.");
  const packages = packagesIn(source);
  if (packages.length > 0) {
    throw new LayoutError(
      `Das Layout braucht Pakete aus dem Netz (${packages.map((p) => `${p.name}:${p.version}`).join(", ")}). Das geht noch nicht; bitte ohne Pakete.`,
    );
  }
  return packages;
}

/** Prüft und speichert ein neues Layout; die Probe läuft vor dem Speichern, ein ungültiges Layout entsteht gar nicht */
export async function createLayout(actor: string, input: { name: string; art: LayoutArt; source: string }): Promise<{ id: string }> {
  const name = cleanName(input.name);
  const packages = checkSource(input.source);
  if (await nameTaken(name)) throw new LayoutError(`Es gibt schon ein Layout „${name}“.`);
  const id = crypto.randomUUID();
  await checkLayout({ id, source: input.source, art: input.art });
  const sha256 = createHash("sha256").update(input.source).digest("hex");
  await withActor(actor, (tx) =>
    tx.insert(schema.belegLayouts).values({ id, name, art: input.art, source: input.source, sha256, schemaVersion: LAYOUT_SCHEMA_VERSION, packages }),
  );
  return { id };
}

/** Neuer Quelltext für ein bestehendes Layout, etwa nach dem Bearbeiten; die Zuordnung bleibt */
export async function replaceLayoutSource(actor: string, id: string, source: string): Promise<void> {
  const [row] = await db.select({ art: schema.belegLayouts.art }).from(schema.belegLayouts).where(eq(schema.belegLayouts.id, id));
  if (!row) throw new LayoutError("Das Layout gibt es nicht mehr.");
  const packages = checkSource(source);
  await checkLayout({ id, source, art: row.art });
  const sha256 = createHash("sha256").update(source).digest("hex");
  await withActor(actor, (tx) =>
    tx
      .update(schema.belegLayouts)
      .set({ source, sha256, packages, approvedSha256: null, schemaVersion: LAYOUT_SCHEMA_VERSION, updatedAt: new Date() })
      .where(eq(schema.belegLayouts.id, id)),
  );
}

export async function renameLayout(actor: string, id: string, input: string): Promise<void> {
  const name = cleanName(input);
  if (await nameTaken(name, id)) throw new LayoutError(`Es gibt schon ein Layout „${name}“.`);
  await withActor(actor, (tx) => tx.update(schema.belegLayouts).set({ name, updatedAt: new Date() }).where(eq(schema.belegLayouts.id, id)));
}

/** Löscht das Layout; wo es zugeordnet war, gilt wieder das eingebaute */
export async function deleteLayout(actor: string, id: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx.delete(schema.belegLayouts).where(eq(schema.belegLayouts.id, id));
    const fallback = JSON.stringify(DEFAULT_LAYOUT);
    await tx.execute(sql`
      update letterhead_profiles set settings = jsonb_set(settings, '{layouts}', (
        select coalesce(jsonb_object_agg(key, case when value->>'kind' = 'eigen' and value->>'id' = ${id} then ${fallback}::jsonb else value end), '{}'::jsonb)
        from jsonb_each(coalesce(settings->'layouts', '{}'::jsonb))
      )), updated_at = now()
      where settings->'layouts' is not null`);
  });
}

/** Ordnet einer Belegart ein Layout zu; ein eigenes muss zur Art passen (Mahnung oder Beleg) */
export async function assignLayout(actor: string, type: LayoutDocumentType, ref: LayoutRef): Promise<void> {
  if (ref.kind === "eingebaut" && ref.id !== DEFAULT_LAYOUT.id) throw new LayoutError("Dieses eingebaute Layout gibt es nicht.");
  if (ref.kind === "eigen") {
    const [row] = await db.select({ art: schema.belegLayouts.art }).from(schema.belegLayouts).where(eq(schema.belegLayouts.id, ref.id));
    if (!row) throw new LayoutError("Das Layout gibt es nicht mehr.");
    if (row.art !== artFor(type))
      throw new LayoutError(row.art === "mahnung" ? "Ein Layout für Mahnungen passt nur zu Mahnungen." : "Mahnungen brauchen ein Layout für Mahnungen.");
  }
  const value = JSON.stringify({ [type]: { kind: ref.kind, id: ref.id } });
  await withActor(actor, async (tx) => {
    const current = await loadDesign(tx);
    const profiles = schema.letterheadProfiles;
    // In der Datenbank zusammenführen, wie saveDesign: Zwei gleichzeitige Zuordnungen überschreiben sich nicht
    await tx
      .insert(profiles)
      .values({ name: "Standard", isDefault: true, settings: { ...current, layouts: { ...current.layouts, [type]: ref } } })
      .onConflictDoUpdate({
        target: profiles.isDefault,
        targetWhere: sql`${profiles.isDefault}`,
        set: {
          settings: sql`jsonb_set(letterhead_profiles.settings, '{layouts}', coalesce(letterhead_profiles.settings->'layouts', '{}'::jsonb) || ${value}::jsonb)`,
          updatedAt: new Date(),
        },
      });
  });
}

export class LayoutRenderError extends LayoutError {}

/** Das eigene Layout, das für die Belegart gilt; null = eingebaut */
export async function customLayoutFor(type: LayoutDocumentType) {
  const ref = (await loadDesign()).layouts[type];
  if (ref.kind !== "eigen") return null;
  const [row] = await db.select().from(schema.belegLayouts).where(eq(schema.belegLayouts.id, ref.id));
  if (!row) throw new LayoutRenderError("Das zugeordnete Layout gibt es nicht mehr. Bitte unter Einstellungen › Beleggestaltung ein anderes wählen.");
  return row;
}

/**
 * Erzeugt ein PDF mit dem Layout der Belegart. build ist der Aufruf aus @haben/einvoice (etwa buildEInvoice); er läuft
 * bei einem eigenen Layout zweimal: erst fängt pdfFrom die fertigen Daten ab, dann liefert es das PDF aus dem Render-Prozess.
 */
export async function withCustomLayout<T>(type: LayoutDocumentType, letterhead: Letterhead, build: (letterhead: Letterhead) => T): Promise<T> {
  const layout = await customLayoutFor(type);
  if (!layout) return build(letterhead);
  let request: PdfRequest | undefined;
  // Ganz durchlaufen lassen: buildEInvoice setzt das PDF erst nach einem await
  await build({
    ...letterhead,
    pdfFrom: (captured) => {
      request = captured;
      return undefined;
    },
  });
  if (!request) return build(letterhead);
  let pdf: Uint8Array;
  try {
    pdf = await layoutRenderer.renderPdf(await customLayoutJob(layout, dataForVersion(layout.schemaVersion, request.data), letterhead), request.date);
  } catch (error) {
    throw new LayoutRenderError(
      `Das Layout „${layout.name}“ ließ sich nicht setzen: ${typstMeldung(error)}. Bitte unter Einstellungen › Beleggestaltung ein anderes wählen.`,
    );
  }
  return build({ ...letterhead, pdfFrom: () => pdf });
}
