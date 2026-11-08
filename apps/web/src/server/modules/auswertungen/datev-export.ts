import { UserError } from "../../errors.ts";
import { ACCOUNTS, personenkontenBetroffen, personenkontenIm } from "@haben/core";
import { buildDatevBuchungsstapel, type DatevExportEntry, personenkontenEinsetzen } from "@haben/import";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { loadCompany } from "../stammdaten/index.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { datevVorgaenge } from "./datev-vorgaenge.ts";

/** DATEV-Buchungsstapel eines Jahres für die Steuerberatung */

export class DatevExportError extends UserError {}

export const datevNumbersSchema = z.object({
  beraterNr: z
    .string()
    .trim()
    .regex(/^\d{4,7}$/, "Die Beraternummer hat 4 bis 7 Ziffern."),
  mandantNr: z
    .string()
    .trim()
    .regex(/^\d{1,5}$/, "Die Mandantennummer hat 1 bis 5 Ziffern."),
  /** DATEV-Personenkonten ab diesem Jahr (#327); null = Sammelkonten, fehlt = unverändert */
  personenkontenAb: z.optional(z.nullable(z.number().int().min(2000, "Jahr zwischen 2000 und 2100").max(2100, "Jahr zwischen 2000 und 2100"))),
  /** Bestätigt, dass die Änderung schon gebuchte Jahre bis heute betrifft */
  bestaetigt: z.boolean().optional(),
});

/** Jahre mit Buchungen; für die Bestätigung beim Schalter „DATEV-Personenkonten“ */
export async function gebuchteJahre(): Promise<number[]> {
  const rows = await db.selectDistinct({ year: sql<number>`extract(year from ${schema.journalEntries.date})::int` }).from(schema.journalEntries);
  return rows.map((r) => r.year).sort((a, b) => a - b);
}

const jahreText = (years: number[]) =>
  years.length === 1 ? `den Buchungsstapel für ${years[0]}` : `die Buchungsstapel für ${years.slice(0, -1).join(", ")} und ${years.at(-1)}`;

export async function saveDatevNumbers(actor: string, input: z.input<typeof datevNumbersSchema>, now = new Date()): Promise<void> {
  const { beraterNr, mandantNr, personenkontenAb, bestaetigt } = datevNumbersSchema.parse(input);
  if (personenkontenAb !== undefined) {
    const company = await loadCompany();
    const years = personenkontenBetroffen(company.datevPersonenkontenAb, personenkontenAb, await gebuchteJahre(), now.getFullYear());
    if (years.length > 0 && !bestaetigt) {
      throw new DatevExportError(
        `Die Änderung betrifft ${jahreText(years)}, der schon Buchungen ${years.length === 1 ? "hat" : "haben"}. Ein schon an die Steuerberatung gegebener Stapel sieht danach anders aus; bestätige das ausdrücklich.`,
      );
    }
  }
  await withActor(actor, (tx) =>
    tx
      .update(schema.company)
      .set({ datevBeraterNr: beraterNr, datevMandantNr: mandantNr, ...(personenkontenAb === undefined ? {} : { datevPersonenkontenAb: personenkontenAb }) })
      .where(eq(schema.company.id, 1)),
  );
}

/** Höchstens so viele Vorgänge nennt die Ablehnung, damit die Meldung lesbar bleibt */
const MAX_PROBLEME = 30;

function personenkontenProblem(probleme: string[]): DatevExportError {
  const shown = probleme.slice(0, MAX_PROBLEME).map((p) => `- ${p}`);
  if (probleme.length > MAX_PROBLEME) shown.push(`- und ${probleme.length - MAX_PROBLEME} weitere`);
  return new DatevExportError(
    ["Für die Personenkonten fehlen Angaben. Ordne den Vorgängen einen Kontakt zu bzw. trage am Kontakt die Nummer ein:", ...shown].join("\n"),
  );
}

/**
 * Mit Personenkonten (Schalter in den Firmendaten) braucht der Export ein actor: Er hält fest, welche Nummern er
 * geschrieben hat; ab dann sind sie am Kontakt fest (datev_personenkonten, Trigger in 0171).
 */
export async function datevExport(year: number, now = new Date(), actor?: string): Promise<{ bytes: Uint8Array; filename: string; bookings: number }> {
  const company = await loadCompany();
  if (!company.datevBeraterNr || !company.datevMandantNr) throw new DatevExportError("Berater- und Mandantennummer fehlen.");
  const entries = await db
    .select()
    .from(schema.journalEntries)
    .where(and(gte(schema.journalEntries.date, `${year}-01-01`), lte(schema.journalEntries.date, `${year}-12-31`)))
    .orderBy(asc(schema.journalEntries.date), asc(schema.journalEntries.createdAt), asc(schema.journalEntries.id));
  // Kontenrahmen des Jahres aus den Buchungen: Nach einem Wechsel bleibt das Vorjahr im alten Rahmen exportierbar
  const rahmen = [...new Set(entries.map((e) => e.kontenrahmen))].sort();
  if (rahmen.length > 1) {
    throw new DatevExportError(`Im Jahr ${year} gibt es Buchungen in ${rahmen.join(" und ")}. Ein DATEV-Stapel hat nur einen Kontenrahmen.`);
  }
  const kontenrahmen = rahmen[0] ?? company.kontenrahmen;
  const lines = entries.length
    ? await db
        .select()
        .from(schema.journalLines)
        .where(
          inArray(
            schema.journalLines.entryId,
            entries.map((e) => e.id),
          ),
        )
    : [];
  const byEntry = new Map<string, typeof lines>();
  for (const line of lines) byEntry.set(line.entryId, [...(byEntry.get(line.entryId) ?? []), line]);
  const vorgaenge = await datevVorgaenge(entries);
  const journal = entries.map((e) => {
    const vorgang = vorgaenge.get(e.sourceId);
    return {
      date: e.date,
      description: e.description,
      voucher: vorgang?.voucher ?? "",
      locked: e.lockedAt !== null,
      lines: (byEntry.get(e.id) ?? []).map((l) => ({ account: l.account, debit: l.debit, credit: l.credit })),
      bezug: vorgang?.bezug ?? null,
    };
  });
  let exportEntries: DatevExportEntry[] = journal;
  let verwendet: { rolle: "debitor" | "kreditor"; nummer: number }[] = [];
  if (personenkontenIm(company.datevPersonenkontenAb, year)) {
    const { forderungen, verbindlichkeiten } = ACCOUNTS[kontenrahmen];
    const result = personenkontenEinsetzen(journal, { forderungen, verbindlichkeiten });
    if ("probleme" in result) throw personenkontenProblem(result.probleme);
    exportEntries = result.entries;
    verwendet = result.verwendet;
  }
  const { bytes, rows } = buildDatevBuchungsstapel(
    {
      beraterNr: company.datevBeraterNr,
      mandantNr: company.datevMandantNr,
      fiscalYearStart: `${year}-01-01`,
      dateFrom: `${year}-01-01`,
      dateTo: `${year}-12-31`,
      description: `Haben ${year}`,
      kontenrahmen,
      createdAt: now,
    },
    exportEntries,
  );
  if (verwendet.length > 0) await vermerkePersonenkonten(actor, verwendet, year);
  return { bytes, filename: `EXTF_Buchungsstapel_${year}.csv`, bookings: rows.length };
}

/** Exportierte Nummern festhalten, je Kontakt und Rolle einmal; der Trigger prüft, dass die Nummer noch am Kontakt steht */
async function vermerkePersonenkonten(actor: string | undefined, verwendet: { rolle: "debitor" | "kreditor"; nummer: number }[], year: number): Promise<void> {
  if (!actor) throw new Error("Der Export mit Personenkonten braucht einen Benutzer für das Änderungsprotokoll.");
  await withActor(actor, async (tx) => {
    for (const rolle of ["debitor", "kreditor"] as const) {
      const nummern = verwendet.filter((v) => v.rolle === rolle).map((v) => v.nummer);
      if (nummern.length === 0) continue;
      const column = rolle === "debitor" ? schema.contacts.debitorNr : schema.contacts.kreditorNr;
      const owners = await tx.select({ id: schema.contacts.id, nummer: column }).from(schema.contacts).where(inArray(column, nummern));
      if (owners.length === 0) continue;
      await tx
        .insert(schema.datevPersonenkonten)
        .values(owners.map((o) => ({ contactId: o.id, rolle, nummer: o.nummer!, jahr: year })))
        .onConflictDoNothing();
    }
  });
}
