import { isKapitalgesellschaft, JOURNAL_KENNZAHLEN, monthsOfPeriod, periodLabel, formatEuro, type JournalKennzahl } from "@haben/core";
import { desc, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import type { JournalUmstellungBefund } from "../../db/schema.ts";
import { euerForYear } from "../auswertungen/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { gesendeteAbweichungen, gesendetText } from "../umsatzsteuer/index.ts";
import { euerAusNebenbuechern } from "./euer-nebenbuecher.ts";
import { kennzahlenBeiderQuellen } from "./vat-nebenbuecher.ts";

/*
 * Prüfung beim Update auf das Journal als einzige Quelle von Voranmeldung und EÜR (#1116, docs/adr/journal-als-quelle.md).
 * Bis 0.x rechneten Jahre vor dem Stichjahr (company.journal_ab, Migration 0192) aus den Nebenbüchern. Für jedes dieser
 * Jahre mit Buchungen muss heute aus dem Journal dasselbe herauskommen:
 * - Zeiträume mit gesendeter Voranmeldung: die gespeicherten Werte gegen die Rechnung aus dem Journal (gesendet ist gesendet);
 * - die übrigen Monate: die Kennzahlen aus den Nebenbüchern gegen die aus dem Journal;
 * - im Einzelunternehmen die EÜR des Jahres ebenso. GmbH und UG melden keine EÜR; ihre Übersicht nach Zahlung ist keine
 *   angemeldete Zahl.
 * Bestehen alle Jahre, gilt die Umstellung als bestanden und keine angemeldete Zahl ändert sich. Sonst startet die neue
 * Version nicht (cli.ts), bis die Abweichung ausdrücklich übernommen wird.
 */

export const UMSTELLUNG_ACTOR = "system:umstellung";

export type UmstellungStand = typeof schema.journalUmstellung.$inferSelect;

/** Die zuletzt gespeicherte Prüfung; null nur in einer Datenbank, die die Migration noch nicht kennt */
export async function umstellungStand(q: Db | Tx = db): Promise<UmstellungStand | null> {
  const [stand] = await q.select().from(schema.journalUmstellung).orderBy(desc(schema.journalUmstellung.id)).limit(1);
  return stand ?? null;
}

const feldLabel = (feld: JournalKennzahl) =>
  feld === "steuerfrei" ? "Umsätze zu 0 %" : feld.startsWith("tax") ? `Steuer zu Kz ${feld.slice(3)}` : `Kz ${feld.slice(2)}`;

/** Jahre mit Buchungen vor dem Stichjahr */
async function jahreVor(stichjahr: number, q: Db | Tx): Promise<number[]> {
  const e = schema.journalEntries;
  const rows = await q
    .selectDistinct({ year: sql<number>`extract(year from ${e.date})::int` })
    .from(e)
    .where(sql`extract(year from ${e.date}) < ${stichjahr}`)
    .orderBy(sql`1`);
  return rows.map((r) => Number(r.year));
}

/** Was in den Jahren vor dem früheren Stichjahr aus dem Journal anders herauskäme; leer = bestanden */
export async function umstellungBefunde(stichjahr: number, today: string, q: Db | Tx = db): Promise<JournalUmstellungBefund[]> {
  const befunde: JournalUmstellungBefund[] = [];
  const gmbh = isKapitalgesellschaft((await loadCompany(q)).rechtsform);
  for (const jahr of await jahreVor(stichjahr, q)) {
    const gesendet = await gesendeteAbweichungen([jahr], q);
    for (const a of gesendet) befunde.push({ jahr, text: gesendetText(a) });
    // Monate einer gesendeten Anmeldung prüft der Vergleich mit den gespeicherten Werten
    const r = schema.vatReturns;
    const sent = await q.selectDistinct({ month: r.month }).from(r).where(sql`${r.year} = ${jahr} and ${r.status} = 'sent'`);
    const gemeldet = new Set(sent.flatMap((s) => monthsOfPeriod({ year: jahr, month: s.month }).map((m) => m.month)));
    const letzterMonat = jahr < Number(today.slice(0, 4)) ? 12 : Number(today.slice(5, 7));
    for (let month = 1; month <= letzterMonat; month++) {
      if (gemeldet.has(month)) continue;
      const { journal, nebenbuecher } = await kennzahlenBeiderQuellen({ year: jahr, month }, q);
      const anders = JOURNAL_KENNZAHLEN.filter((feld) => journal[feld] !== nebenbuecher[feld]);
      if (anders.length > 0)
        befunde.push({
          jahr,
          text: `Voranmeldung ${periodLabel({ year: jahr, month })}: ${anders
            .map((feld) => `${feldLabel(feld)} bisher ${formatEuro(nebenbuecher[feld])}, aus dem Journal ${formatEuro(journal[feld])}`)
            .join("; ")}`,
        });
    }
    if (!gmbh) {
      const vorher = await euerAusNebenbuechern(jahr, q);
      const nachher = await euerForYear(jahr, q);
      const zeilen = new Map<string, { label: string; vorher: number; nachher: number }>();
      const dazu = (l: { key: string; label: string; amount: number }, seite: "vorher" | "nachher") => {
        const z = zeilen.get(l.key) ?? { label: l.label, vorher: 0, nachher: 0 };
        z[seite] += l.amount;
        zeilen.set(l.key, z);
      };
      for (const l of [...vorher.einnahmen, ...vorher.ausgaben]) dazu(l, "vorher");
      for (const l of [...nachher.einnahmen, ...nachher.ausgaben]) dazu(l, "nachher");
      const anders = [...zeilen.values()].filter((z) => z.vorher !== z.nachher);
      if (vorher.gewinn !== nachher.gewinn) anders.push({ label: "Gewinn", vorher: vorher.gewinn, nachher: nachher.gewinn });
      if (anders.length > 0)
        befunde.push({
          jahr,
          text: `EÜR ${jahr}: ${anders.map((z) => `${z.label} bisher ${formatEuro(z.vorher)}, aus dem Journal ${formatEuro(z.nachher)}`).join("; ")}`,
        });
    }
  }
  return befunde;
}

export type UmstellungErgebnis =
  /** Nichts zu prüfen oder schon geprüft */
  | { status: "fertig"; stand: UmstellungStand | null }
  /** Jetzt geprüft und gespeichert (bestanden oder übernommen) */
  | { status: "gespeichert"; stand: UmstellungStand }
  /** Abweichungen in Jahren, die nicht übernommen sind; nichts gespeichert */
  | { status: "abweichung"; befunde: JournalUmstellungBefund[] };

/**
 * Prüft die Umstellung, wenn sie offen ist, und speichert das Ergebnis. `uebernehmen`: Jahre, deren Abweichungen
 * ausdrücklich übernommen werden (HABEN_ABWEICHUNG_UEBERNEHMEN); dann gelten ab jetzt die Zahlen aus dem Journal, gesendete
 * Voranmeldungen bleiben, wie sie in vat_returns stehen.
 */
export async function umstellungPruefen(today: string, uebernehmen: readonly number[] = [], version: string | null = null): Promise<UmstellungErgebnis> {
  const stand = await umstellungStand();
  if (stand?.ergebnis !== "offen") return { status: "fertig", stand };
  const befunde = stand.stichjahrVorher === null ? [] : await umstellungBefunde(stand.stichjahrVorher, today);
  const offen = befunde.filter((b) => !uebernehmen.includes(b.jahr));
  if (offen.length > 0) return { status: "abweichung", befunde: offen };
  const ergebnis = befunde.length === 0 ? "bestanden" : "uebernommen";
  const [neu] = await withActor(UMSTELLUNG_ACTOR, (tx) =>
    tx.insert(schema.journalUmstellung).values({ stichjahrVorher: stand.stichjahrVorher, ergebnis, befunde, version }).returning(),
  );
  return { status: "gespeichert", stand: neu! };
}
