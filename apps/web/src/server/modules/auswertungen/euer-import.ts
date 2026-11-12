import type { Kontenrahmen } from "@haben/core";
import { inArray } from "drizzle-orm";
import { schema, type Db, type Tx } from "../../db/index.ts";
import { externalSettlementLinks } from "../datenimport/index.ts";
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
  const links = await externalSettlementLinks(
    q,
    jahr.filter((b) => b.sourceType === "import").map((b) => b.sourceId),
  );
  const externalIds = new Map(links.map((r) => [r.paymentId, r.externalId]));
  const payments = new Map<string, string[]>();
  for (const r of links) payments.set(r.originalId, [...(payments.get(r.originalId) ?? []), r.paymentId]);
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
