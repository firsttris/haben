import {
  JOURNAL_KENNZAHLEN,
  kennzahlenAusJournal,
  leereJournalKennzahlen,
  mitBemessungWieHeute,
  periodRange,
  type JournalKennzahlen,
  type JournalZeile,
  type Kontenrahmen,
  type VatPeriod,
  type Versteuerung,
} from "@haben/core";
import { and, asc, eq, gte, lt, notInArray, or, sql } from "drizzle-orm";
import { invoiceTaxReader } from "../rechnungen/index.ts";
import { schema, type Db, type Tx } from "../../db/index.ts";

const updateAufDasJournal = sql`(select min(${schema.journalUmstellung.at}) from ${schema.journalUmstellung})`;

/**
 * Belegbuchung aus einer Version vor dem Update auf das Journal (v0.10): angelegt vor der ersten Zeile in
 * journal_umstellung, die die Migration 0275 beim Update schreibt, oder der Storno einer solchen. Nur solche Buchungen kann
 * Haben vor #551 geschrieben haben; ein späterer Storno kehrt die gebuchten Zeilen um, wenn die heutigen nicht auf jedem
 * Konto dasselbe ergeben (zeilenWieHeute). mitBemessungWieHeute gilt nur für sie, Buchungen neuer Versionen deutet es so
 * nie um (#1396). Ohne die Tabelle oder ihre erste Zeile: keine. Fällt journal_umstellung mit #1201 weg, muss dieser
 * Zeitpunkt bleiben.
 */
export const belegAusAlterVersion = sql<boolean>`(${schema.journalEntries.sourceType} = 'document' and coalesce(
  (select o.created_at from journal_entries o where o.id = ${schema.journalEntries.reversesId}), ${schema.journalEntries.createdAt}
) < ${updateAufDasJournal})`;

/*
 * Kennzahlen der Voranmeldung aus dem Journal (#542, #1116, docs/adr/journal-als-quelle.md): die Quelle der Voranmeldung,
 * wie bei DATEV aus Konto und Steuerschlüssel der Buchungen im Zeitraum (kennzahlenAusJournal). Ohne
 * Eröffnungen (vorgetragen, im Vorjahr angemeldet) und ohne die Buchungen des Anlagenverzeichnisses: Die Privatnutzung von
 * Fahrzeugen rechnet die Voranmeldung je Monat aus dem Anlagenverzeichnis, das Journal bucht sie erst mit der AfA.
 */
export async function kennzahlenAusDemJournal(period: VatPeriod, versteuerung: Versteuerung, q: Db | Tx): Promise<JournalKennzahlen> {
  const { start, end } = periodRange(period);
  const e = schema.journalEntries;
  const l = schema.journalLines;
  const rows = await q
    .select({
      id: e.id,
      kontenrahmen: e.kontenrahmen,
      alt: belegAusAlterVersion,
      account: l.account,
      debit: l.debit,
      credit: l.credit,
      taxCode: l.taxCode,
      basis: l.basis,
      invoiceDate: schema.invoices.issueDate,
      correctsId: schema.invoices.correctsId,
      advanceType: schema.invoices.advanceType,
      invoiceId: schema.invoices.id,
      variant: schema.invoices.variant,
      serviceFrom: schema.invoices.serviceFrom,
      serviceTo: schema.invoices.serviceTo,
      treatment: schema.invoices.taxTreatment,
    })
    .from(l)
    .innerJoin(e, eq(e.id, l.entryId))
    .leftJoin(schema.writeOffs, and(eq(e.sourceType, "ausbuchung"), eq(e.sourceId, schema.writeOffs.id)))
    .leftJoin(schema.invoices, or(eq(schema.invoices.id, schema.writeOffs.invoiceId), and(eq(e.sourceType, "invoice"), eq(e.sourceId, schema.invoices.id))))
    .where(and(gte(e.date, start), lt(e.date, end), notInArray(e.sourceType, ["eroeffnung", "asset"])))
    .orderBy(asc(e.id));
  const buchungen = new Map<string, { kontenrahmen: Kontenrahmen; versteuerung: Versteuerung; alt: boolean; zeilen: JournalZeile[] }>();
  const taxes = invoiceTaxReader(q);
  for (const r of rows) {
    let b = buchungen.get(r.id);
    if (!b) {
      // Auch Storno und Korrektur folgen der ursprünglichen Rechnung.
      const mode = r.invoiceDate
        ? await taxes.postingMode({
            issueDate: r.invoiceDate,
            correctsId: r.correctsId,
            advanceType: r.advanceType,
            id: r.invoiceId ?? undefined,
            variant: r.variant,
            serviceFrom: r.serviceFrom,
            serviceTo: r.serviceTo,
            taxTreatment: r.treatment ?? "regulaer",
          })
        : versteuerung;
      b = { kontenrahmen: r.kontenrahmen as Kontenrahmen, versteuerung: mode, alt: r.alt === true, zeilen: [] };
      buchungen.set(r.id, b);
    }
    b.zeilen.push({ account: r.account, debit: r.debit, credit: r.credit, taxCode: r.taxCode as JournalZeile["taxCode"], basis: r.basis });
  }
  const summe = leereJournalKennzahlen();
  // Ein Jahr hat einen Kontenrahmen; je Kontenrahmen gerechnet, falls ein Zeitraum doch beide sieht
  for (const kr of ["SKR03", "SKR04"] as const)
    for (const mode of ["ist", "soll"] as const) {
      // Belegbuchungen alter Versionen mit § 13b oder Erwerb mit der Bemessungsgrundlage wie heute (#1396)
      const eigene = [...buchungen.values()]
        .filter((b) => b.kontenrahmen === kr && b.versteuerung === mode)
        .map((b) => (b.alt ? mitBemessungWieHeute(kr, b.zeilen) : b.zeilen));
      if (eigene.length === 0) continue;
      const k = kennzahlenAusJournal(kr, mode, eigene);
      for (const feld of JOURNAL_KENNZAHLEN) summe[feld] += k[feld];
    }
  return summe;
}
