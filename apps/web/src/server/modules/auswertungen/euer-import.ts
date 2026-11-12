import type { Kontenrahmen } from "@haben/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Db, type Tx } from "../../db/index.ts";
import { offenerSaldo, rechnungsAnteile } from "./euer-journal-anteile.ts";
import { bloecke, buchungen, offenerPosten, type Buchung, type Zeile } from "./euer-journal-buchungen.ts";

interface ImportAnteil {
  kontenrahmen: Kontenrahmen;
  zeilen: Zeile[];
  anteil: number[];
}

/** Explizite Zahlungsbezüge derselben Quelle; weder Belegnummer noch Importdatum begründen einen Zufluss (§ 11 EStG). */
export async function importAnteile(q: Db | Tx, jahr: Buchung[]): Promise<Map<string, ImportAnteil>> {
  const result = new Map<string, ImportAnteil>();
  const t = schema.externalImports;
  const sources = new Set<string>();
  for (const block of bloecke(jahr.filter((b) => b.sourceType === "import").map((b) => b.sourceId))) {
    for (const r of await q.select({ source: t.source }).from(t).where(inArray(t.id, block))) sources.add(r.source);
  }
  if (!sources.size) return result;
  const imported = await q
    .select({ source: t.source, externalId: t.externalId, entryId: t.entryId, settles: sql<string | null>`${t.payload}->>'settles'` })
    .from(t)
    .where(and(eq(t.kind, "journal"), inArray(t.source, [...sources])));
  const key = (source: string, id: string) => JSON.stringify([source, id]);
  const bySource = new Map(imported.map((r) => [key(r.source, r.externalId), r]));
  const externalIds = new Map(imported.filter((r) => r.entryId).map((r) => [r.entryId!, r.externalId]));
  const payments = new Map<string, string[]>();
  for (const r of imported) {
    if (!r.entryId || !r.settles) continue;
    const original = bySource.get(key(r.source, r.settles));
    if (original?.entryId) payments.set(original.entryId, [...(payments.get(original.entryId) ?? []), r.entryId]);
  }
  const entries = new Map<string, Buchung>();
  for (const block of bloecke([...new Set([...payments.keys(), ...[...payments.values()].flat()])]))
    for (const b of await buchungen(q, inArray(schema.journalEntries.id, block))) entries.set(b.id, b);
  for (const [id, ids] of payments) {
    const original = entries.get(id)!;
    const kr = original.kontenrahmen;
    const zeilen = original.zeilen.filter((z) => !offenerPosten(kr, z));
    const ausgleiche = ids
      .map((id) => entries.get(id)!)
      .sort((a, b) => a.date.localeCompare(b.date) || externalIds.get(a.id)!.localeCompare(externalIds.get(b.id)!));
    const anteile = rechnungsAnteile(kr, zeilen, offenerSaldo(original), ausgleiche);
    for (const [paymentId, anteil] of anteile) result.set(paymentId, { kontenrahmen: kr, zeilen, anteil });
  }
  return result;
}
