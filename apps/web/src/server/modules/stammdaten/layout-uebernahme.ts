import { createHash } from "node:crypto";
import { LAYOUT_SCHEMA_VERSION } from "@haben/einvoice";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";
import { checkLayout, LayoutError, LayoutPaketFehltError } from "./layout-pruefung.ts";
import { checkLimits, checkSource, cleanName, envLimits, type LayoutArt, type LayoutLimits } from "./layouts.ts";
import { type LayoutPackage, packageSpec } from "./paket-download.ts";

/**
 * Layout aus der Einstellungsdatei einer anderen Instanz (#488) in der Transaktion des Aufrufers, mit seiner ID, damit die
 * Gestaltung es weiter zuordnet. Es setzt das Layout ohne Pakete zur Probe (brauchtPakete). Pakete lädt es nicht: Ihre
 * Freigabe galt dort für genau diesen Quelltext, nachgeladen und dabei zur Probe gesetzt werden sie wie nach einem
 * Restore nur auf Klick (reloadPackages, das die Liste mit Typst Universe neu abgleicht).
 */
export async function insertImportedLayout(
  tx: Tx,
  input: { id: string; name: string; art: LayoutArt; source: string; schemaVersion: number; packages: LayoutPackage[] },
  limits: LayoutLimits = envLimits(),
): Promise<void> {
  const name = cleanName(input.name);
  // In der Transaktion gezählt, damit die Layouts derselben Datei mitzählen
  await checkLimits(limits, Buffer.byteLength(input.source, "utf8"), undefined, tx);
  const genannt = new Set(input.packages.map(packageSpec));
  const roots = checkSource(input.source);
  // Pakete ohne #import im Quelltext lädt „Pakete neu laden“ nie; das Layout bliebe ohne Probesatz freigegeben
  if (roots.some((pkg) => !genannt.has(packageSpec(pkg))) || (roots.length === 0 && genannt.size > 0))
    throw new LayoutError("Die Pakete passen nicht zum Quelltext.");
  if (input.schemaVersion < 1 || input.schemaVersion > LAYOUT_SCHEMA_VERSION)
    throw new LayoutError(
      `Das Layout ist für den Feldvertrag v${input.schemaVersion} geschrieben; diese Version von Haben kennt bis v${LAYOUT_SCHEMA_VERSION}.`,
    );
  const [vorhanden] = await tx.select({ id: schema.belegLayouts.id }).from(schema.belegLayouts).where(eq(schema.belegLayouts.name, name));
  if (vorhanden) throw new LayoutError(`Es gibt schon ein Layout „${name}“.`);
  const packages = (await brauchtPakete(input)) ? input.packages.map(({ name, version }) => ({ name, version })) : [];
  const sha256 = createHash("sha256").update(input.source).digest("hex");
  await tx.insert(schema.belegLayouts).values({
    id: input.id,
    name,
    art: input.art,
    source: input.source,
    sha256,
    schemaVersion: input.schemaVersion,
    packages,
    approvedSha256: packages.length > 0 ? sha256 : null,
  });
}

/**
 * Setzt das Layout ohne Paket-Cache zur Probe (#488). Gelingt das, braucht es keine Pakete, auch wenn der Quelltext eines
 * nennt, etwa in einem Kommentar; dann gilt der Probesatz wie bei einem Layout ohne Pakete. Scheitert es nur an einem
 * fehlenden Paket, setzt es erst „Pakete neu laden“ zur Probe. Jeder andere Fehler lehnt das Layout ab.
 */
async function brauchtPakete(layout: { id: string; source: string; art: LayoutArt; packages: readonly LayoutPackage[] }): Promise<boolean> {
  try {
    await checkLayout({ id: layout.id, source: layout.source, art: layout.art });
    return false;
  } catch (error) {
    if (error instanceof LayoutPaketFehltError && layout.packages.length > 0) return true;
    throw error;
  }
}
