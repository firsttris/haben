import { asc, between, inArray } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { loadFile } from "../../storage.ts";
import { csv, type CsvValue, money } from "./csv.ts";
import { safeName } from "./export-paths.ts";
import type { ArchiveFile } from "./export-zip.ts";

/*
 * Mahnungen aus der bisherigen Buchhaltung (legacy_dunnings) im Jahresexport, nach Datum der Mahnung. Wie die
 * Auftragsdokumente getrennt von den Belegen: Mahnungen sind keine Forderung und kein Umsatz, als Handelsbriefe aber
 * aufzubewahren (§ 147 Abs. 1 Nr. 2 und 3 AO).
 */

const encoder = new TextEncoder();

export async function* dunningFiles(year: number, problems: string[]): AsyncGenerator<ArchiveFile> {
  const dunnings = await db
    .select()
    .from(schema.legacyDunnings)
    .where(between(schema.legacyDunnings.date, `${year}-01-01`, `${year}-12-31`))
    .orderBy(asc(schema.legacyDunnings.date), asc(schema.legacyDunnings.externalId));
  if (!dunnings.length) return;
  const files = await db
    .select()
    .from(schema.legacyDunningFiles)
    .where(
      inArray(
        schema.legacyDunningFiles.dunningId,
        dunnings.map((d) => d.id),
      ),
    )
    .orderBy(asc(schema.legacyDunningFiles.createdAt), asc(schema.legacyDunningFiles.id));
  const rows: CsvValue[][] = [];
  for (const dunning of dunnings) {
    const base = `${dunning.source}/mahnungen/${dunning.date}_${safeName(dunning.number || dunning.externalId)}_${dunning.id.slice(0, 8)}`;
    yield { path: `${base}/quelle.json`, content: encoder.encode(JSON.stringify(dunning.raw, null, 2)), compress: true };
    const attached = files.filter((f) => f.dunningId === dunning.id);
    if (!attached.length) problems.push(`${dunning.source}-Mahnung ${dunning.number || dunning.externalId}: PDF fehlt.`);
    for (const file of attached) {
      try {
        yield {
          path: `${base}/${file.id.slice(0, 8)}_${safeName(file.filename, 100, "mahnung.pdf")}`,
          content: new Uint8Array(await loadFile(file.sha256)),
          compress: false,
        };
      } catch {
        problems.push(`${dunning.source}-Mahnung ${dunning.number || dunning.externalId}: PDF ${file.filename} nicht lesbar.`);
      }
    }
    rows.push([
      dunning.date,
      dunning.number,
      dunning.level,
      dunning.invoiceExternalId,
      dunning.contactName,
      dunning.dueDate,
      dunning.sentDate,
      dunning.status,
      dunning.currency,
      money(dunning.total),
      dunning.externalId,
      attached.map((f) => f.sha256).join(" | "),
    ]);
  }
  const sources = [...new Set(dunnings.map((d) => d.source))];
  for (const source of sources) {
    yield {
      path: `${source}/mahnungen.csv`,
      content: csv(
        [
          "Datum",
          "Nummer",
          "Stufe in der Quelle",
          "Gemahnte Rechnung (Quell-ID)",
          "Kontakt",
          "Frist",
          "Versendet",
          "Quellstatus",
          "Währung",
          "Gemahnter Betrag",
          "Quell-ID",
          "SHA-256",
        ],
        rows.filter((_, i) => dunnings[i]!.source === source),
      ),
      compress: true,
    };
  }
}
