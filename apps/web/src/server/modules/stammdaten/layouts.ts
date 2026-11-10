import { createHash } from "node:crypto";
import { readdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DEFAULT_LAYOUT, type LayoutDocumentType, type LayoutRef } from "@haben/core";
import { createRenderClient, LAYOUT_SCHEMA_VERSION, type Letterhead, type PdfRequest } from "@haben/einvoice";
import { asc, eq, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { env } from "../../env.ts";
import { db, schema } from "../../db/index.ts";
import { checkLayout, LayoutError, MAX_LAYOUT_BYTES, packagesIn, typstMeldung } from "./layout-pruefung.ts";
import { clearPackages, directorySize, dropRenderer, packageCache, packagesPresent, rendererFor, samePackages } from "./layout-pakete.ts";
import {
  type LayoutPackage,
  type PackageFetcher,
  packageSpec,
  type ResolvedPackage,
  resolvePackages,
  universeFetcher,
  writePackages,
} from "./paket-download.ts";
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
  const rows = await db
    .select({ ...columns, approvedSha256: schema.belegLayouts.approvedSha256 })
    .from(schema.belegLayouts)
    .orderBy(asc(schema.belegLayouts.name));
  return Promise.all(
    rows.map(async ({ approvedSha256, ...row }) => ({
      ...row,
      // Nach einem Restore ohne das Volume: freigegeben, aber nicht mehr da; nachladen nur von Hand
      packagesMissing: row.packages.length > 0 && approvedSha256 === row.sha256 && !(await packagesPresent(row.id, row.packages)),
    })),
  );
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

function checkSource(source: string): LayoutPackage[] {
  if (!source.trim()) throw new LayoutError("Die Datei ist leer.");
  if (Buffer.byteLength(source, "utf8") > MAX_LAYOUT_BYTES) throw new LayoutError("Ein Layout darf höchstens 256 KB groß sein.");
  return packagesIn(source);
}

/** Ergebnis, wenn das Layout Pakete braucht, die noch nicht freigegeben sind: nichts ist gespeichert oder geladen */
export interface NeedsApproval {
  needsApproval: string[];
}

export interface LayoutLimits {
  /** Höchstzahl eigener Layouts (LAYOUTS_MAX_COUNT) */
  maxCount?: number | undefined;
  /** Speicher in Byte, Quelltexte und Pakete zusammen (LAYOUTS_MAX_MB) */
  maxBytes?: number | undefined;
}

export interface LayoutDeps {
  /** Archiv eines Pakets holen; ohne Angabe aus Typst Universe */
  fetch?: PackageFetcher;
  limits?: LayoutLimits;
}

/** Grenzen des Betreibers aus der Umgebung; ohne Angabe unbegrenzt */
export function envLimits(): LayoutLimits {
  const { LAYOUTS_MAX_COUNT, LAYOUTS_MAX_MB } = env();
  return { maxCount: LAYOUTS_MAX_COUNT, maxBytes: LAYOUTS_MAX_MB ? LAYOUTS_MAX_MB * 1024 * 1024 : undefined };
}

/** Platz aller Layouts ohne das genannte: Quelltexte in der Datenbank und Paket-Caches */
async function usedBytes(except?: string): Promise<number> {
  const rows = await db.select({ id: schema.belegLayouts.id, source: schema.belegLayouts.source }).from(schema.belegLayouts);
  let total = 0;
  for (const row of rows.filter((r) => r.id !== except)) total += Buffer.byteLength(row.source, "utf8") + (await directorySize(await packageCache(row.id)));
  return total;
}

const megabytes = (bytes: number) => `${Math.ceil(bytes / 1024 / 1024)} MB`;

/** Prüft, ob noch ein Layout bzw. so viel Platz frei ist; replacing ist das Layout, das ersetzt wird */
async function checkLimits(limits: LayoutLimits, bytes: number, replacing?: string): Promise<void> {
  if (!replacing && limits.maxCount !== undefined) {
    const rows = await db.select({ id: schema.belegLayouts.id }).from(schema.belegLayouts);
    if (rows.length >= limits.maxCount) {
      throw new LayoutError(`Es sind schon ${rows.length} eigene Layouts gespeichert, mehr erlaubt diese Installation nicht. Lösche erst eines.`);
    }
  }
  if (limits.maxBytes !== undefined && (await usedBytes(replacing)) + bytes > limits.maxBytes) {
    throw new LayoutError(`Für eigene Layouts sind auf dieser Installation höchstens ${megabytes(limits.maxBytes)} frei, mit diesem Layout wären es mehr.`);
  }
}

const running = new Map<string, Promise<unknown>>();

/**
 * Prüfen, Tauschen des Caches und Speichern eines Layouts nacheinander: Zwei gleichzeitige Ersetzungen teilten sich sonst
 * den Ordner pakete-neu, und der Cache passte danach nicht mehr zum gespeicherten Quelltext
 */
function oneAtATime<T>(id: string, work: () => Promise<T>): Promise<T> {
  const before = running.get(id) ?? Promise.resolve();
  const result = before.then(work, work);
  const done = result.catch(() => undefined);
  running.set(id, done);
  void done.then(() => {
    if (running.get(id) === done) running.delete(id);
  });
  return result;
}

/**
 * Schreibt die geladenen Pakete in einen Ordner neben dem Cache und prüft das Layout damit. Erst wenn die Prüfung passt,
 * ersetzt er den Cache; scheitert sie, bleibt der bisherige Cache, und das gespeicherte Layout setzt weiter.
 */
async function prepare(id: string, source: string, art: LayoutArt, packages: readonly ResolvedPackage[]) {
  const cache = await packageCache(id);
  const staging = `${cache}-neu`;
  await rm(staging, { recursive: true, force: true });
  try {
    if (packages.length > 0) {
      await writePackages(staging, packages);
      const renderer = createRenderClient({ cacheDir: staging });
      try {
        await checkLayout({ id, source, art }, renderer);
      } finally {
        renderer.close();
      }
    } else await checkLayout({ id, source, art }, layoutRenderer);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  await dropRenderer(id);
  await clearPackages(id);
  if (packages.length > 0) await rename(staging, cache);
}

const plain = (packages: readonly ResolvedPackage[]): LayoutPackage[] => packages.map(({ name, version }) => ({ name, version }));
const packageBytes = (packages: readonly ResolvedPackage[]) => packages.reduce((sum, p) => sum + p.bytes, 0);

/**
 * Pakete samt Abhängigkeiten laden (nur in den Speicher) und gegen die Freigabe halten: Ohne genau diese Liste als approve
 * kommt die Liste zurück, und nichts ist gespeichert.
 */
async function approvedPackages(
  source: string,
  approve: readonly string[] | undefined,
  fetch: PackageFetcher,
): Promise<{ packages: ResolvedPackage[] } | NeedsApproval> {
  const roots = checkSource(source);
  if (roots.length === 0) return { packages: [] };
  const packages = await resolvePackages(roots, fetch);
  const specs = packages.map(packageSpec);
  return samePackages(specs, approve ?? []) ? { packages } : { needsApproval: specs };
}

/**
 * Prüft und speichert ein neues Layout; ein ungültiges entsteht gar nicht. Braucht es Pakete, kommt erst die Liste zurück,
 * und Haben lädt sie erst, wenn genau diese Liste als approve wiederkommt (Rückfrage in der Oberfläche).
 */
export async function createLayout(
  actor: string,
  input: { name: string; art: LayoutArt; source: string; approve?: string[] },
  { fetch = universeFetcher(env().LAYOUTS_PACKAGES_URL), limits = envLimits() }: LayoutDeps = {},
): Promise<{ id: string } | NeedsApproval> {
  const name = cleanName(input.name);
  checkSource(input.source);
  if (await nameTaken(name)) throw new LayoutError(`Es gibt schon ein Layout „${name}“.`);
  const bytes = Buffer.byteLength(input.source, "utf8");
  await checkLimits(limits, bytes);
  const approval = await approvedPackages(input.source, input.approve, fetch);
  if ("needsApproval" in approval) return approval;
  const id = crypto.randomUUID();
  await checkLimits(limits, bytes + packageBytes(approval.packages));
  await prepare(id, input.source, input.art, approval.packages);
  const packages = plain(approval.packages);
  const sha256 = createHash("sha256").update(input.source).digest("hex");
  await withActor(actor, (tx) =>
    tx.insert(schema.belegLayouts).values({
      id,
      name,
      art: input.art,
      source: input.source,
      sha256,
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      packages,
      approvedSha256: packages.length > 0 ? sha256 : null,
    }),
  );
  return { id };
}

/** Neuer Quelltext für ein bestehendes Layout; die Zuordnung bleibt, Pakete fragen neu */
export async function replaceLayoutSource(
  actor: string,
  id: string,
  source: string,
  approve?: string[],
  { fetch = universeFetcher(env().LAYOUTS_PACKAGES_URL), limits = envLimits() }: LayoutDeps = {},
): Promise<{ ok: true } | NeedsApproval> {
  const [row] = await db.select({ art: schema.belegLayouts.art }).from(schema.belegLayouts).where(eq(schema.belegLayouts.id, id));
  if (!row) throw new LayoutError("Das Layout gibt es nicht mehr.");
  checkSource(source);
  const bytes = Buffer.byteLength(source, "utf8");
  await checkLimits(limits, bytes, id);
  const approval = await approvedPackages(source, approve, fetch);
  if ("needsApproval" in approval) return approval;
  await checkLimits(limits, bytes + packageBytes(approval.packages), id);
  const packages = plain(approval.packages);
  const sha256 = createHash("sha256").update(source).digest("hex");
  await oneAtATime(id, async () => {
    await prepare(id, source, row.art, approval.packages);
    await withActor(actor, (tx) =>
      tx
        .update(schema.belegLayouts)
        .set({ source, sha256, packages, approvedSha256: packages.length > 0 ? sha256 : null, schemaVersion: LAYOUT_SCHEMA_VERSION, updatedAt: new Date() })
        .where(eq(schema.belegLayouts.id, id)),
    );
  });
  return { ok: true };
}

/** Lädt die schon freigegebenen Pakete neu, etwa nach einem Restore ohne Cache; nur auf Klick, nie von selbst */
export function reloadPackages(id: string, deps: LayoutDeps = {}): Promise<void> {
  return oneAtATime(id, () => reload(id, deps));
}

async function reload(id: string, { fetch = universeFetcher(env().LAYOUTS_PACKAGES_URL) }: LayoutDeps): Promise<void> {
  const [row] = await db.select().from(schema.belegLayouts).where(eq(schema.belegLayouts.id, id));
  if (!row) throw new LayoutError("Das Layout gibt es nicht mehr.");
  if (row.packages.length === 0 || row.approvedSha256 !== row.sha256) throw new LayoutError("Dieses Layout hat keine freigegebenen Pakete.");
  // Versionen in Typst Universe ändern sich nicht; kommt doch eine andere Liste heraus, braucht es eine neue Freigabe
  const packages = await resolvePackages(checkSource(row.source), fetch);
  if (!samePackages(packages.map(packageSpec), row.packages.map(packageSpec))) {
    throw new LayoutError("Die Pakete des Layouts haben sich geändert. Lade das Layout neu hoch, um sie freizugeben.");
  }
  await prepare(id, row.source, row.art, packages);
}

/**
 * Beim Start: Ordner unter DOCUMENTS_DIR/vorlagen ohne zugehöriges Layout entfernen, etwa nach einem Absturz mitten im
 * Hochladen oder nach einer Wiederherstellung der Datenbank auf einen älteren Stand
 */
export async function removeOrphanWorkspaces(): Promise<string[]> {
  const root = join(resolve(env().DOCUMENTS_DIR), "vorlagen");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const ids = new Set((await db.select({ id: schema.belegLayouts.id }).from(schema.belegLayouts)).map((row) => row.id));
  const removed = entries.filter((entry) => entry.isDirectory() && !ids.has(entry.name)).map((entry) => entry.name);
  for (const name of removed) await rm(join(root, name), { recursive: true, force: true });
  return removed;
}

export async function renameLayout(actor: string, id: string, input: string): Promise<void> {
  const name = cleanName(input);
  if (await nameTaken(name, id)) throw new LayoutError(`Es gibt schon ein Layout „${name}“.`);
  await withActor(actor, (tx) => tx.update(schema.belegLayouts).set({ name, updatedAt: new Date() }).where(eq(schema.belegLayouts.id, id)));
}

/** Löscht das Layout; wo es zugeordnet war, gilt wieder das eingebaute */
export function deleteLayout(actor: string, id: string): Promise<void> {
  return oneAtATime(id, () => removeLayout(actor, id));
}

async function removeLayout(actor: string, id: string): Promise<void> {
  await dropRenderer(id);
  await clearPackages(id);
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
    const renderer = await rendererFor(layout);
    pdf = await renderer.renderPdf(await customLayoutJob(layout, dataForVersion(layout.schemaVersion, request.data), letterhead), request.date);
  } catch (error) {
    throw new LayoutRenderError(
      `Das Layout „${layout.name}“ ließ sich nicht setzen: ${typstMeldung(error)}. Bitte unter Einstellungen › Beleggestaltung ein anderes wählen.`,
    );
  }
  return build({ ...letterhead, pdfFrom: () => pdf });
}
