import {
  datevOpeningIssues,
  datevOpeningLines,
  isKapitalgesellschaft,
  manualPosting,
  schlussbilanzIssues,
  type Cents,
  type Kontenrahmen,
  type ManualLine,
} from "@haben/core";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { formatDate } from "../../../lib/format.ts";
import { lockCash } from "../bank/index.ts";
import { accountName, activeOpenings, firstEntryBefore, lockOpenings, openBooks, openingAfter, post, takeoverBalances } from "../buchhaltung/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { datevAbschluss, type DatevVortrag } from "./datev-abschluss.ts";

/*
 * Eröffnung aus der Schlussbilanz des DATEV-Stapels (GmbH, UG): Für das erste Jahr in Haben schlägt Haben die
 * Eröffnungsbuchung aus dem letzten archivierten Stapeljahr vor, alle Bestandskonten mit Saldo gegen 9000 am 1. Januar.
 * Gebucht wird erst, wenn der Nutzer den Vorschlag bestätigt, und genau der Vorschlag, den er gesehen hat (Prüfsumme).
 * Die Zeilen kommen nie vom Browser, sondern werden beim Buchen neu gerechnet; deshalb darf diese Eröffnung die Konten
 * der Nebenbücher bebuchen, die manuelle nicht (datevOpeningIssues in @haben/core).
 */

export class DatevEroeffnungError extends UserError {}

export interface DatevEroeffnungZeile extends ManualLine {
  name: string;
}

export interface DatevEroeffnung {
  /** Letztes Jahr im archivierten Stapel; seine Schlussbilanz wird eröffnet */
  schlussjahr: number;
  /** Erstes Jahr in Haben; die Eröffnung steht am 1. Januar */
  year: number;
  date: string;
  kontenrahmen: Kontenrahmen;
  vortrag: DatevVortrag;
  /** Summe der Aktiva in der Schlussbilanz, zum Vergleich mit dem Abschluss der Steuerberatung */
  bilanzsumme: Cents;
  zeilen: DatevEroeffnungZeile[];
  /** Warum sich der Vorschlag nicht buchen lässt; leer = buchbar */
  issues: string[];
  /** Zur Kenntnis, hindert nicht */
  hinweise: string[];
  /** SHA-256 über Jahr und Zeilen: Gebucht wird nur, was der Nutzer gesehen hat */
  fingerprint: string;
  /** Schon gebucht: die Eröffnung aus dem Stapel im Journal */
  gebucht: { id: string; date: string } | null;
}

async function lastStapelYear(q: Db | Tx): Promise<number | null> {
  const [row] = await q.select({ last: sql<string | null>`max(${schema.datevBookings.date})` }).from(schema.datevBookings);
  return row?.last ? Number(row.last.slice(0, 4)) : null;
}

/** Die Stapel-Datei des Jahres als Beleg der Eröffnung (sourceId); bei mehreren die zuletzt archivierte */
async function stapelFile(q: Db | Tx, year: number): Promise<string> {
  const [row] = await q
    .select({ id: schema.archiveFiles.id })
    .from(schema.archiveFiles)
    .innerJoin(schema.datevBookings, eq(schema.datevBookings.fileId, schema.archiveFiles.id))
    .where(and(gte(schema.datevBookings.date, `${year}-01-01`), lt(schema.datevBookings.date, `${year + 1}-01-01`)))
    .orderBy(desc(schema.archiveFiles.uploadedAt), desc(schema.archiveFiles.id))
    .limit(1);
  return row!.id;
}

const fingerprintOf = (year: number, lines: readonly ManualLine[]) =>
  createHash("sha256")
    .update(JSON.stringify({ year, lines: lines.map((l) => [l.account, l.debit, l.credit]) }))
    .digest("hex");

/** Bedingungen im Journal: nichts davor gebucht, keine andere Eröffnung, Übernahmen nur im Eröffnungsjahr */
async function journalIssues(q: Db | Tx, year: number, spaeter: string | null): Promise<string[]> {
  const date = `${year}-01-01`;
  const [earlier, after, openings] = await Promise.all([firstEntryBefore(q, date), openingAfter(q, date), activeOpenings(q)]);
  const manual = openings.find((o) => !o.ausStapel);
  return [
    ...(earlier ? [`Vor dem 1.1.${year} gibt es schon Buchungen (ab ${formatDate(earlier)}); ihre Salden trägt Haben selbst vor`] : []),
    ...(after ? [`Die Bücher beginnen schon am ${formatDate(after)} mit einer Eröffnung; davor lässt sich nichts buchen`] : []),
    ...(manual ? [`Es gibt schon eine Eröffnung vom ${formatDate(manual.date)}; für die Eröffnung aus dem Stapel sie zuerst stornieren`] : []),
    ...(spaeter ? [`Offene Posten oder Anlagen sind nach ${year} gegen 9000 übernommen (${formatDate(spaeter)}); das lässt sich nicht herausrechnen`] : []),
  ];
}

/** Vorschlag (oder gebuchte Eröffnung) aus dem letzten archivierten Stapeljahr; null ohne Stapel oder im Einzelunternehmen */
async function proposal(q: Db | Tx, today: string): Promise<DatevEroeffnung | null> {
  const company = await loadCompany(q);
  if (!isKapitalgesellschaft(company.rechtsform)) return null;
  const schlussjahr = await lastStapelYear(q);
  if (schlussjahr === null) return null;
  const abschluss = await datevAbschluss(schlussjahr);
  if (!abschluss) return null;
  const kontenrahmen = company.kontenrahmen;
  const year = schlussjahr + 1;
  const date = `${year}-01-01`;
  const name = (account: string) => accountName(kontenrahmen, account);
  const gebucht = (await activeOpenings(q)).find((o) => o.ausStapel) ?? null;
  const takeovers = await takeoverBalances(q, date, `${year + 1}-01-01`);
  // Ist sie gebucht, rechnet die Übernahme nichts mehr heraus; der Vorschlag zeigt dann nur noch den Stand
  const lines = datevOpeningLines(kontenrahmen, abschluss.salden, gebucht ? [] : takeovers.salden);
  const issues = [
    ...(gebucht ? [`Die Eröffnung aus dem DATEV-Stapel ist gebucht (${formatDate(gebucht.date)})`] : []),
    ...(date > today ? [`Das Jahr ${year} hat noch nicht begonnen`] : []),
    ...abschluss.issues.filter((i) => i.tone === "fehler").map((i) => i.text.replace(/\.$/, "")),
    ...schlussbilanzIssues(abschluss.report, name),
    ...(gebucht ? [] : await journalIssues(q, year, takeovers.spaeter)),
    ...datevOpeningIssues(lines, kontenrahmen, company.rechtsform),
  ];
  const hinweise = [
    ...(abschluss.vortrag === "keiner"
      ? [
          `Der Stapel ${schlussjahr} bringt keine Eröffnungsbuchungen mit und es gibt keinen Stapel davor. Das passt nur, wenn die Gesellschaft ${schlussjahr} gegründet wurde; sonst fehlen die Bestände zum 1.1.${schlussjahr}.`,
        ]
      : []),
    ...(!gebucht && takeovers.salden.length > 0
      ? [
          "Schon übernommene offene Posten und Anlagen sind herausgerechnet; Forderungen, Verbindlichkeiten und 9000 stimmen danach mit der Schlussbilanz überein.",
        ]
      : []),
  ];
  return {
    schlussjahr,
    year,
    date,
    kontenrahmen,
    vortrag: abschluss.vortrag,
    bilanzsumme: abschluss.report.aktiva,
    zeilen: lines.map((l) => ({ ...l, name: name(l.account) })),
    issues,
    hinweise,
    fingerprint: fingerprintOf(year, lines),
    gebucht: gebucht ? { id: gebucht.id, date: gebucht.date } : null,
  };
}

/** Vorschlag für die Eröffnung aus dem DATEV-Stapel, nur lesend */
export function datevEroeffnung(today: string): Promise<DatevEroeffnung | null> {
  return proposal(db, today);
}

export const datevEroeffnungSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * Bucht den bestätigten Vorschlag: neu gerechnet in der buchenden Transaktion, nur wenn er unverändert ist. Die Kasse
 * und dann die Hash-Kette werden zuerst gesperrt (Reihenfolge wie im Kassenbuch); der Kassenbestand der Eröffnung ist der
 * Anfangsbestand des Kassenbuchs, gleichzeitige Kassenbuchungen und Übernahmen warten.
 */
export async function bookDatevEroeffnung(actor: string, input: z.input<typeof datevEroeffnungSchema>, today: string): Promise<string> {
  const parsed = datevEroeffnungSchema.parse(input);
  return withActor(actor, async (tx) => {
    await lockCash(tx);
    await lockOpenings(tx);
    const vorschlag = await proposal(tx, today);
    if (!vorschlag)
      throw new DatevEroeffnungError("Für eine Eröffnung aus dem DATEV-Stapel fehlt ein archivierter Stapel, oder die Rechtsform ist keine GmbH oder UG.");
    if (vorschlag.year !== parsed.year || vorschlag.fingerprint !== parsed.fingerprint) {
      throw new DatevEroeffnungError("Der Vorschlag hat sich inzwischen geändert. Bitte die Seite neu laden und die Zeilen noch einmal prüfen.");
    }
    if (vorschlag.issues.length > 0) throw new DatevEroeffnungError(`${vorschlag.issues.join(". ")}.`);
    const books = await openBooks(tx);
    return post(tx, books, {
      date: vorschlag.date,
      description: `Eröffnung aus der Schlussbilanz ${vorschlag.schlussjahr} (DATEV-Stapel)`,
      sourceType: "eroeffnung",
      sourceId: await stapelFile(tx, vorschlag.schlussjahr),
      lines: manualPosting(vorschlag.zeilen.map(({ account, debit, credit }) => ({ account, debit, credit }))),
    });
  });
}
