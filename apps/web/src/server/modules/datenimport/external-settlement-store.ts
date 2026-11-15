import { externalSettlementProblem, type Kontenrahmen } from "@haben/core";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";
import { externalJournalSchema, type ExternalImport, type ExternalJournal } from "./external-schema.ts";
import { ExternalImportError } from "./external-validation.ts";

/** Vorhandene Bezüge bleiben unverändert; beide Eingabeformen laufen durch dieselbe Prüfung unter der Quellsperre. */
export async function prepareExternalSettlements(
  tx: Tx,
  source: string,
  kr: Kontenrahmen,
  input: ExternalImport,
  previous: (typeof schema.externalImports.$inferSelect)[],
) {
  const p = schema.externalImports;
  const s = schema.externalImportSettlements;
  const journals = new Map<string, ExternalJournal>(
    previous.filter((r) => r.kind === "journal").map((r) => [r.externalId, externalJournalSchema.parse(r.payload)]),
  );
  for (const e of input.entries) if (e.kind === "journal") journals.set(e.externalId, { ...externalJournalSchema.parse(e) });
  const byId = new Map(previous.map((r) => [r.id, r]));
  const known = new Map<string, string>();
  for (const r of await tx
    .select({ payment: s.paymentImportId, original: s.originalImportId })
    .from(s)
    .innerJoin(p, eq(p.id, s.paymentImportId))
    .where(eq(p.source, source))) {
    known.set(byId.get(r.payment)!.externalId, byId.get(r.original)!.externalId);
  }
  const links = new Map<string, string>();
  for (const r of [
    ...input.entries.flatMap((e) => (e.kind === "journal" && e.settles ? [{ paymentExternalId: e.externalId, originalExternalId: e.settles }] : [])),
    ...(input.settlements ?? []),
  ]) {
    const old = known.get(r.paymentExternalId) ?? links.get(r.paymentExternalId);
    if (old && old !== r.originalExternalId) throw new ExternalImportError("Der bestätigte Zahlungsbezug bleibt unverändert.");
    if (!journals.has(r.paymentExternalId) || !journals.has(r.originalExternalId))
      throw new ExternalImportError(`Buchung ${r.paymentExternalId}: Zahlungsbezug ungültig; Quellbuchung fehlt.`);
    links.set(r.paymentExternalId, r.originalExternalId);
  }
  for (const [payment, original] of [...known, ...links]) journals.set(payment, { ...journals.get(payment)!, settles: original });
  const frames = new Map<string, Kontenrahmen>();
  for (const r of await tx
    .select({ id: p.externalId, kr: schema.journalEntries.kontenrahmen })
    .from(p)
    .innerJoin(schema.journalEntries, eq(p.entryId, schema.journalEntries.id))
    .where(eq(p.source, source)))
    frames.set(r.id, r.kr as Kontenrahmen);
  for (const e of input.entries) if (e.kind === "journal" && !frames.has(e.externalId)) frames.set(e.externalId, kr);
  for (const frame of ["SKR03", "SKR04"] as const) {
    const targets = new Set(
      [...links]
        .filter(([payment, original]) => {
          if (frames.get(payment) !== frames.get(original))
            throw new ExternalImportError("Zahlungsbezug mit unterschiedlichen Kontenrahmen; Quellbuchungen abgleichen.");
          return frames.get(original) === frame;
        })
        .map(([, original]) => original),
    );
    const problem = externalSettlementProblem(
      frame,
      [...journals.values()].filter((e) => targets.has(e.externalId) || (e.settles && targets.has(e.settles))),
    );
    if (problem) throw new ExternalImportError(problem);
  }
  return links;
}

/** Einziger Schreiber der nur anhängbaren Zuordnungen, auch beim Nachpflegen eines alten Pakets. */
export async function storeExternalSettlements(tx: Tx, source: string, links: Map<string, string>) {
  if (!links.size) return 0;
  const t = schema.externalImports;
  const rows = await tx
    .select({ id: t.id, externalId: t.externalId })
    .from(t)
    .where(and(eq(t.source, source), eq(t.kind, "journal")));
  const ids = new Map(rows.map((r) => [r.externalId, r.id]));
  const created = await tx
    .insert(schema.externalImportSettlements)
    .values([...links].map(([payment, original]) => ({ paymentImportId: ids.get(payment)!, originalImportId: ids.get(original)! })))
    .onConflictDoNothing()
    .returning({ id: schema.externalImportSettlements.id });
  return created.length;
}
