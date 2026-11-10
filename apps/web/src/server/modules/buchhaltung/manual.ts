import {
  ACCOUNTS,
  FREIE_STEUERSCHLUESSEL,
  type FreierSteuerschluessel,
  freieBuchungIssues,
  freieBuchungPosting,
  isKapitalgesellschaft,
  manualPosting,
  manualPostingIssues,
  MANUAL_MAX_LINES,
  type PostingLine,
  type TaxCode,
  reverseManualPosting,
  zeilenImKontenrahmen,
} from "@haben/core";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { schema, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { journalAbJahr, kleinunternehmerHistory } from "../stammdaten/index.ts";
import { today } from "../../today.ts";
import { activeOpenings, lockOpenings, openingDependents } from "./eroeffnung.ts";
import { periodReported } from "./gemeldet.ts";
import { openBooks, post } from "./ledger.ts";

/*
 * Manuelle Buchungen (Umbuchungen) für GmbH und UG, ab dem Stichjahr auch im Einzelunternehmen und mit Steuerschlüssel
 * (freie Buchungen, docs/adr/journal-als-quelle.md, Entscheidung 4). Sie haben keine eigene Tabelle: Die Buchung im Journal ist schon
 * festgeschrieben und versiegelt, die Herkunft „manuell“ und ihre eigene ID als sourceId genügen. Korrigiert wird per
 * Gegenbuchung (reversesId) wie überall im Hauptbuch.
 */

export class ManualEntryError extends UserError {}

const cents = z.number().int().min(0).max(100_000_000_00);

export const manualEntrySchema = z.object({
  /** Umbuchung oder Eröffnungsbuchung (Saldenvortrag aus der bisherigen Buchhaltung), siehe ManualKind in @haben/core */
  kind: z.enum(["umbuchung", "eroeffnung"]).default("umbuchung"),
  date: z.iso.date(),
  /** Buchungstext; bei einer Umbuchung ohne fremden Beleg ist er der Eigenbeleg */
  description: z.string().trim().min(3, "Buchungstext fehlt").max(300),
  lines: z
    .array(
      z.object({
        account: z.string().trim(),
        debit: cents,
        credit: cents,
        /** Steuerschlüssel einer freien Buchung; der Betrag der Zeile ist dann brutto */
        taxCode: z
          .enum(Object.keys(FREIE_STEUERSCHLUESSEL) as [FreierSteuerschluessel, ...FreierSteuerschluessel[]])
          .nullable()
          .default(null),
      }),
    )
    .min(2)
    .max(MANUAL_MAX_LINES),
});

export type ManualEntryInput = z.input<typeof manualEntrySchema>;

/**
 * Bucht eine manuelle Buchung. In GmbH und UG jederzeit, mit Steuerschlüssel ab dem Stichjahr. Im Einzelunternehmen nur
 * ab dem Stichjahr: Davor rechnet die EÜR aus Rechnungen, Belegen und Zahlungen, eine Buchung nur im Journal käme dort nie
 * an. Eine freie Buchung (Einzelunternehmen oder mit Steuerschlüssel) liegt nicht in einem gemeldeten Zeitraum.
 */
export async function createManualEntry(actor: string, input: ManualEntryInput, today: string): Promise<string> {
  const parsed = manualEntrySchema.parse(input);
  if (parsed.date > today) throw new ManualEntryError("Das Datum liegt in der Zukunft.");
  return withActor(actor, async (tx) => {
    const books = await openBooks(tx);
    const gmbh = isKapitalgesellschaft(books.rechtsform);
    if (!gmbh && parsed.kind === "eroeffnung") {
      throw new ManualEntryError("Eröffnungsbuchungen gibt es nur für GmbH und UG; im Einzelunternehmen rechnet die EÜR aus Rechnungen und Belegen.");
    }
    const issues = manualPostingIssues(parsed.lines, books.kontenrahmen, books.rechtsform, parsed.kind);
    if (parsed.kind === "eroeffnung") issues.push(...(await openingIssues(tx, parsed.date)));
    const mitSchluessel = parsed.lines.some((l) => l.taxCode);
    if (!gmbh || mitSchluessel) {
      const kleinunternehmer = (await kleinunternehmerHistory(tx))(parsed.date);
      const ausDemJournal = Number(parsed.date.slice(0, 4)) >= (await journalAbJahr(tx));
      issues.push(...freieBuchungIssues(parsed.lines, { kontenrahmen: books.kontenrahmen, rechtsform: books.rechtsform, kleinunternehmer, ausDemJournal }));
      if (await periodReported(tx, parsed.date)) issues.push("Der Zeitraum des Datums ist schon gemeldet; die Buchung gehört in den laufenden Zeitraum");
    }
    if (issues.length > 0) throw new ManualEntryError(`${issues.join(". ")}.`);
    return post(tx, books, {
      date: parsed.date,
      description: parsed.description,
      sourceType: parsed.kind === "eroeffnung" ? "eroeffnung" : "manuell",
      sourceId: crypto.randomUUID(),
      lines: mitSchluessel ? freieBuchungPosting(parsed.lines, books.kontenrahmen) : manualPosting(parsed.lines),
    });
  });
}

/**
 * Eine Eröffnung steht am 1. Januar des ersten Jahres in Haben: Davor darf es keine Buchung geben, sonst trägt Haben die
 * Salden selbst vor (Saldenvortrag in der Saldenliste) und die Eröffnung zählte doppelt.
 */
async function openingIssues(tx: Tx, date: string): Promise<string[]> {
  if (!date.endsWith("-01-01")) return ["Eine Eröffnungsbuchung steht am 1. Januar"];
  const [earlier] = await tx.select({ id: schema.journalEntries.id }).from(schema.journalEntries).where(lt(schema.journalEntries.date, date)).limit(1);
  if (earlier) return [`Vor dem ${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)} gibt es schon Buchungen; ihre Salden trägt Haben selbst vor`];
  // Die Eröffnung aus dem Stapel bringt alle Bestände der Schlussbilanz mit; eine weitere zählte sie doppelt
  const stapel = (await activeOpenings(tx)).find((o) => o.ausStapel);
  return stapel ? ["Die Eröffnung aus dem DATEV-Stapel enthält schon alle Bestände; für eine Änderung sie stornieren und neu eröffnen"] : [];
}

/** Die manuelle Buchung, gesperrt bis zum Ende der Transaktion: zwei gleichzeitige Stornos sehen einander */
async function lockedManualEntry(tx: Tx, entryId: string) {
  const [entry] = await tx
    .select()
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.id, entryId), inArray(schema.journalEntries.sourceType, ["manuell", "eroeffnung"])))
    .for("update");
  if (!entry) throw new ManualEntryError("Manuelle Buchung nicht gefunden.");
  if (entry.reversesId) throw new ManualEntryError("Eine Gegenbuchung lässt sich nicht stornieren.");
  const [already] = await tx.select({ id: schema.journalEntries.id }).from(schema.journalEntries).where(eq(schema.journalEntries.reversesId, entryId));
  if (already) throw new ManualEntryError("Die Buchung ist bereits storniert.");
  return entry;
}

/**
 * Prüfung vor dem Storno einer Eröffnung, die die Kasse bebucht (aus dem DATEV-Stapel): Das Kassenbuch zählt den
 * Bestand zum Anfangsbestand. Das Kassenbuch führt das Modul Bank und Kasse; es reicht die Prüfung herein.
 */
export type CashReversalCheck = (tx: Tx, date: string, amount: number) => Promise<void>;

/**
 * Eine Eröffnung, auf die Übernahmen ohne eigene Buchung oder Anlagen bauen, bleibt stehen: Ihr Storno nähme deren
 * Bestände mit, und eine neue Eröffnung brächte sie nicht zurück. Sperrt vorher wie Übernahme und Eröffnung (nach der Kasse).
 */
async function assertNoDependents(tx: Tx, entryId: string): Promise<void> {
  await lockOpenings(tx);
  const { uebernahmen, anlagen } = await openingDependents(tx, entryId);
  const gruende = [
    ...(uebernahmen > 0
      ? [`${uebernahmen === 1 ? "ein übernommener offener Posten steht" : `${uebernahmen} übernommene offene Posten stehen`} nur in ihr`]
      : []),
    ...(anlagen > 0 ? [`${anlagen === 1 ? "eine Anlage verweist" : `${anlagen} Anlagen verweisen`} auf sie`] : []),
  ];
  if (gruende.length > 0) throw new ManualEntryError(`Die Eröffnung lässt sich nicht stornieren: ${gruende.join(", ")}.`);
}

/**
 * Storniert eine manuelle Buchung mit einer Gegenbuchung am selben Tag, damit sie im selben Zeitraum aufgeht; Steuerschlüssel
 * und Bemessungsgrundlagen dreht sie mit. Eine freie Buchung (mit Steuerschlüssel oder im Einzelunternehmen), deren Zeitraum
 * schon gemeldet ist oder die in einem anderen Kontenrahmen gebucht ist, storniert sie am Tag `todayDate`, mit den Konten
 * derselben Rolle im neuen Kontenrahmen. Sonst lehnt das Hauptbuch einen Tag in einem Jahr mit anderem Kontenrahmen ab.
 * Bebucht sie die Kasse, prüft `checkCash`, dass der Kassenbestand ohne sie an keinem Tag negativ wird; ohne Prüfung wird
 * sie nicht storniert.
 */
export async function reverseManualEntry(actor: string, entryId: string, checkCash?: CashReversalCheck, todayDate = today()): Promise<string> {
  return withActor(actor, async (tx) => {
    const entry = await lockedManualEntry(tx, entryId);
    const books = await openBooks(tx);
    const gelesen = await tx
      .select({
        account: schema.journalLines.account,
        debit: schema.journalLines.debit,
        credit: schema.journalLines.credit,
        taxCode: schema.journalLines.taxCode,
        basis: schema.journalLines.basis,
      })
      .from(schema.journalLines)
      .where(eq(schema.journalLines.entryId, entryId))
      .orderBy(asc(schema.journalLines.id));
    // Die Zeilen schrieb ledger.post, ihre Steuerschlüssel sind solche aus TaxCode
    const lines: PostingLine[] = gelesen.map((l) => ({ ...l, taxCode: l.taxCode as TaxCode | null }));
    const kasse = lines.filter((l) => l.account === ACCOUNTS[entry.kontenrahmen].kasse).reduce((sum, l) => sum + l.debit - l.credit, 0);
    if (kasse !== 0) {
      if (!checkCash) throw new ManualEntryError("Die Buchung bebucht die Kasse; der Storno braucht die Prüfung des Kassenbuchs.");
      await checkCash(tx, entry.date, -kasse);
    }
    if (entry.sourceType === "eroeffnung") await assertNoDependents(tx, entry.id);
    const frei = entry.sourceType === "manuell" && (!isKapitalgesellschaft(books.rechtsform) || lines.some((l) => l.taxCode));
    const laufend = frei && (entry.kontenrahmen !== books.kontenrahmen || (await periodReported(tx, entry.date)));
    const zeilen = laufend ? zeilenImKontenrahmen(entry.kontenrahmen, books.kontenrahmen, lines) : lines;
    if (!zeilen) {
      throw new ManualEntryError(
        `Die Buchung ist im Kontenrahmen ${entry.kontenrahmen} gebucht, eingestellt ist jetzt ${books.kontenrahmen}; nicht jedes Konto hat dort eine eindeutige Entsprechung.`,
      );
    }
    return post(tx, books, {
      date: laufend && todayDate > entry.date ? todayDate : entry.date,
      description: `Storno: ${entry.description}`,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      reversesId: entry.id,
      lines: reverseManualPosting(zeilen),
    });
  });
}
