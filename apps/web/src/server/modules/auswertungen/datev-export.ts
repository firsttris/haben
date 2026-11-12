import { UserError } from "../../errors.ts";
import { ACCOUNTS, currentYear, PERSONENKONTO_LABEL, personenkontenBetroffen, personenkontenIm } from "@haben/core";
import { buildDatevBuchungsstapel, type DatevExportEntry, personenkontenEinsetzen } from "@haben/import";
import { and, asc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { loadCompany, personenkontoKey, vergibPersonenkonten } from "../stammdaten/index.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { darf, type Rolle } from "../../../lib/rollen.ts";
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
    const years = personenkontenBetroffen(company.datevPersonenkontenAb, personenkontenAb, await gebuchteJahre(), currentYear(now));
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
      .where(
        and(
          eq(schema.company.id, 1),
          or(
            sql`${schema.company.datevBeraterNr} is distinct from ${beraterNr}`,
            sql`${schema.company.datevMandantNr} is distinct from ${mandantNr}`,
            personenkontenAb === undefined ? undefined : sql`${schema.company.datevPersonenkontenAb} is distinct from ${personenkontenAb}`,
          ),
        ),
      ),
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

/** Wer exportiert; festschreiben darf nur eine Rolle mit Zugriff „inhaber“ */
export interface DatevExporteur {
  id: string;
  role: Rolle;
}

/**
 * Mit Personenkonten (Schalter in den Firmendaten) hält der Export fest, welche Nummern er geschrieben hat; ab dann sind
 * sie am Kontakt fest (datev_personenkonten, Trigger in 0172). Neue Nummern festschreiben darf nur der Inhaber; wer nur
 * lesen darf, bekommt den Stapel, solange alle Nummern darin schon festgeschrieben sind, und schreibt dabei nichts (#452).
 */
export async function datevExport(
  year: number,
  now = new Date(),
  exporteur?: DatevExporteur,
): Promise<{ bytes: Uint8Array; filename: string; bookings: number }> {
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
  const storniert = await stornierte(entries.map((e) => e.id));
  const journal = entries.map((e) => {
    const vorgang = vorgaenge.get(e.sourceId);
    return {
      id: e.id,
      reversesId: e.reversesId,
      storniert: storniert.has(e.id),
      // Die Eröffnung und offene Posten, die nur in ihr stehen, bleiben auf dem Sammelkonto (#452)
      eroeffnung: e.sourceType === "eroeffnung" || vorgang?.inEroeffnung === true,
      date: e.date,
      description: e.description,
      voucher: vorgang?.voucher ?? "",
      locked: e.lockedAt !== null,
      lines: (byEntry.get(e.id) ?? []).map((l) => ({ account: l.account, debit: l.debit, credit: l.credit })),
      bezug: vorgang?.bezug ?? null,
      contactId: vorgang?.contactId ?? null,
    };
  });
  let exportEntries: DatevExportEntry[] = journal;
  let verwendet: { rolle: "debitor" | "kreditor"; nummer: number }[] = [];
  if (personenkontenIm(company.datevPersonenkontenAb, year)) {
    const { forderungen, verbindlichkeiten } = ACCOUNTS[kontenrahmen];
    const sammelkonto = { debitor: forderungen, kreditor: verbindlichkeiten } as const;
    // Fehlende Nummern vergeben, aber nur für Kontakte, deren Buchungen ein Sammelkonto berühren und nicht wie die
    // Eröffnung dort bleiben
    const fehlend = journal.flatMap((e) =>
      !e.eroeffnung && e.contactId && e.bezug?.kontakt?.nummer === null && e.lines.some((l) => l.account === sammelkonto[e.bezug!.rolle])
        ? [{ contactId: e.contactId, rolle: e.bezug.rolle }]
        : [],
    );
    // Vergeben schreibt wie das Festschreiben, deshalb nur durch den Inhaber (#452)
    if (fehlend.length > 0 && (!exporteur || !darf(exporteur.role, "inhaber"))) throw ohneNummer(journal, fehlend);
    const vergeben = fehlend.length > 0 ? await vergibFuerExport(exporteur!.id, fehlend) : new Map<string, number>();
    for (const e of journal) {
      const nummer = e.contactId && e.bezug?.kontakt ? vergeben.get(personenkontoKey(e.contactId, e.bezug.rolle)) : undefined;
      if (nummer !== undefined && e.bezug?.kontakt) e.bezug = { ...e.bezug, kontakt: { ...e.bezug.kontakt, nummer } };
    }
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
  if (verwendet.length > 0) await festschreiben(exporteur, verwendet, year);
  return { bytes, filename: `EXTF_Buchungsstapel_${year}.csv`, bookings: rows.length };
}

/** Ablehnung für jemanden ohne Recht zum Vergeben: welche Kontakte noch keine Nummer haben */
function ohneNummer(
  journal: readonly { contactId: string | null; bezug: { kontakt: { name: string } | null } | null }[],
  fehlend: readonly { contactId: string; rolle: "debitor" | "kreditor" }[],
): DatevExportError {
  const namen = new Map(journal.flatMap((e) => (e.contactId && e.bezug?.kontakt ? [[e.contactId, e.bezug.kontakt.name] as const] : [])));
  const liste = [...new Set(fehlend.map((f) => `${PERSONENKONTO_LABEL[f.rolle]} für ${namen.get(f.contactId) ?? "einen Kontakt"}`))].join(", ");
  return new DatevExportError(
    `Der erste Export mit neuen Personenkonten muss vom Inhaber kommen, weil er fehlende Nummern vergibt und festschreibt. Noch ohne Nummer: ${liste}.`,
  );
}

/** Vergabe für den Export; ein voller Bereich kommt als DatevExportError, damit der Download die Meldung zeigt statt eines 500 */
async function vergibFuerExport(actor: string, fehlend: Parameters<typeof vergibPersonenkonten>[1]): Promise<Map<string, number>> {
  try {
    return await vergibPersonenkonten(actor, fehlend);
  } catch (error) {
    if (error instanceof UserError) throw new DatevExportError(error.message);
    throw error;
  }
}

/** Buchungen, die eine Gegenbuchung haben, auch in einem anderen Jahr */
async function stornierte(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.select({ id: schema.journalEntries.reversesId }).from(schema.journalEntries).where(inArray(schema.journalEntries.reversesId, ids));
  return new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
}

/**
 * Exportierte Nummern festhalten, je Kontakt und Rolle einmal; der Trigger prüft, dass die Nummer noch am Kontakt steht.
 * Sind alle schon festgeschrieben, schreibt der Export nichts; sonst nur, wenn er vom Inhaber kommt.
 */
async function festschreiben(
  exporteur: DatevExporteur | undefined,
  verwendet: { rolle: "debitor" | "kreditor"; nummer: number }[],
  year: number,
): Promise<void> {
  const neu: { contactId: string; name: string; rolle: "debitor" | "kreditor"; nummer: number }[] = [];
  for (const rolle of ["debitor", "kreditor"] as const) {
    const nummern = verwendet.filter((v) => v.rolle === rolle).map((v) => v.nummer);
    if (nummern.length === 0) continue;
    const column = rolle === "debitor" ? schema.contacts.debitorNr : schema.contacts.kreditorNr;
    const owners = await db
      .select({ contactId: schema.contacts.id, name: schema.contacts.name, nummer: column })
      .from(schema.contacts)
      .where(inArray(column, nummern));
    const fest = new Set(
      (
        await db
          .select({ nummer: schema.datevPersonenkonten.nummer })
          .from(schema.datevPersonenkonten)
          .where(and(eq(schema.datevPersonenkonten.rolle, rolle), inArray(schema.datevPersonenkonten.nummer, nummern)))
      ).map((r) => r.nummer),
    );
    neu.push(...owners.filter((o) => o.nummer !== null && !fest.has(o.nummer)).map((o) => ({ ...o, rolle, nummer: o.nummer! })));
  }
  if (neu.length === 0) return;
  if (!exporteur || !darf(exporteur.role, "inhaber")) {
    const liste = neu.map((n) => `${PERSONENKONTO_LABEL[n.rolle]} ${n.nummer} (${n.name})`).join(", ");
    throw new DatevExportError(
      `Der erste Export mit neuen Personenkonten muss vom Inhaber kommen, weil er die Nummern festschreibt. Noch nicht festgeschrieben: ${liste}.`,
    );
  }
  await withActor(exporteur.id, (tx) =>
    tx
      .insert(schema.datevPersonenkonten)
      .values(neu.map((n) => ({ contactId: n.contactId, rolle: n.rolle, nummer: n.nummer, jahr: year })))
      .onConflictDoNothing(),
  );
}
