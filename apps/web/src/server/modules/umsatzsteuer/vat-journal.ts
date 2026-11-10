import {
  JOURNAL_KENNZAHLEN,
  kennzahlenAusJournal,
  leereJournalKennzahlen,
  periodRange,
  type JournalKennzahlen,
  type JournalZeile,
  type Kontenrahmen,
  type VatPeriod,
  type Versteuerung,
} from "@haben/core";
import { and, asc, eq, gte, lt, notInArray } from "drizzle-orm";
import { schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Kennzahlen der Voranmeldung aus dem Journal (#542, docs/adr/journal-als-quelle.md): ab dem Stichjahr die Quelle der
 * Voranmeldung, wie bei DATEV aus Konto und Steuerschlüssel der Buchungen im Zeitraum (kennzahlenAusJournal). Ohne
 * Eröffnungen (vorgetragen, im Vorjahr angemeldet) und ohne die Buchungen des Anlagenverzeichnisses: Die Privatnutzung von
 * Fahrzeugen rechnet die Voranmeldung je Monat aus dem Anlagenverzeichnis, das Journal bucht sie erst mit der AfA.
 * `nurManuell`: nur die manuellen Buchungen (freie Buchungen, #502); sie haben kein Nebenbuch, ihr Beleg ist die
 * festgeschriebene Buchung selbst, und sie zählen deshalb auch in der Gegenprobe aus den Nebenbüchern.
 */
export async function kennzahlenAusDemJournal(period: VatPeriod, versteuerung: Versteuerung, q: Db | Tx, nurManuell = false): Promise<JournalKennzahlen> {
  const { start, end } = periodRange(period);
  const e = schema.journalEntries;
  const l = schema.journalLines;
  const rows = await q
    .select({ id: e.id, kontenrahmen: e.kontenrahmen, account: l.account, debit: l.debit, credit: l.credit, taxCode: l.taxCode, basis: l.basis })
    .from(l)
    .innerJoin(e, eq(e.id, l.entryId))
    .where(and(gte(e.date, start), lt(e.date, end), nurManuell ? eq(e.sourceType, "manuell") : notInArray(e.sourceType, ["eroeffnung", "asset"])))
    .orderBy(asc(e.id));
  const buchungen = new Map<string, { kontenrahmen: Kontenrahmen; zeilen: JournalZeile[] }>();
  for (const r of rows) {
    const b = buchungen.get(r.id) ?? { kontenrahmen: r.kontenrahmen as Kontenrahmen, zeilen: [] };
    b.zeilen.push({ account: r.account, debit: r.debit, credit: r.credit, taxCode: r.taxCode as JournalZeile["taxCode"], basis: r.basis });
    buchungen.set(r.id, b);
  }
  const summe = leereJournalKennzahlen();
  // Ein Jahr hat einen Kontenrahmen; je Kontenrahmen gerechnet, falls ein Zeitraum doch beide sieht
  for (const kr of ["SKR03", "SKR04"] as const) {
    const eigene = [...buchungen.values()].filter((b) => b.kontenrahmen === kr).map((b) => b.zeilen);
    if (eigene.length === 0) continue;
    const k = kennzahlenAusJournal(kr, versteuerung, eigene);
    for (const feld of JOURNAL_KENNZAHLEN) summe[feld] += k[feld];
  }
  return summe;
}
