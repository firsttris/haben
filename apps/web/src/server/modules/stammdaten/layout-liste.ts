import { LAYOUT_DOCUMENT_TYPES } from "@haben/core";
import { gestaltungsHinweise, type LayoutJeBeleg, ungenutzteGestaltung } from "@haben/einvoice";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { packagesPresent } from "./layout-pakete.ts";
import { loadDesign } from "./letterhead.ts";

/* Eigene Belegvorlagen (#113) zum Anzeigen: Liste, Quelltext zum Herunterladen und was die Gestaltung davon wissen muss */

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
    .select({ ...columns, approvedSha256: schema.belegLayouts.approvedSha256, source: schema.belegLayouts.source })
    .from(schema.belegLayouts)
    .orderBy(asc(schema.belegLayouts.name));
  return Promise.all(
    rows.map(async ({ approvedSha256, source, ...row }) => ({
      ...row,
      // Nach einem Restore ohne das Volume: freigegeben, aber nicht mehr da; nachladen nur von Hand
      packagesMissing: row.packages.length > 0 && approvedSha256 === row.sha256 && !(await packagesPresent(row.id, row.packages)),
      // Einstellungen der Gestaltung, deren Felder der Quelltext nicht nennt; die Oberfläche deaktiviert sie danach
      ungenutzt: ungenutzteGestaltung(source, row.art),
    })),
  );
}

/** Eigene Layouts samt den Hinweisen für die Einstellungen der Gestaltung, die eines davon nicht verwendet */
export async function layoutOverview() {
  const [layouts, design] = await Promise.all([listLayouts(), loadDesign()]);
  const byId = new Map(layouts.map((layout) => [layout.id, layout]));
  const assigned = Object.fromEntries(
    LAYOUT_DOCUMENT_TYPES.map((type) => {
      const ref = design.layouts[type];
      // Ein gelöschtes Layout setzt gar nicht; dazu meldet das Erzeugen selbst einen Fehler
      const layout = ref.kind === "eigen" ? byId.get(ref.id) : undefined;
      return [type, layout ? { name: layout.name, ungenutzt: layout.ungenutzt } : null];
    }),
  ) as LayoutJeBeleg;
  return { layouts, hints: gestaltungsHinweise(assigned) };
}

export async function layoutSource(id: string): Promise<{ name: string; source: string } | null> {
  const [row] = await db
    .select({ name: schema.belegLayouts.name, source: schema.belegLayouts.source })
    .from(schema.belegLayouts)
    .where(eq(schema.belegLayouts.id, id));
  return row ?? null;
}
