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
import { and, asc, eq, gte, lt, notInArray, or } from "drizzle-orm";
import { invoiceVatMode } from "../rechnungen/index.ts";
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
    .select({
      id: e.id,
      kontenrahmen: e.kontenrahmen,
      account: l.account,
      debit: l.debit,
      credit: l.credit,
      taxCode: l.taxCode,
      basis: l.basis,
      invoiceDate: schema.invoices.issueDate,
      correctsId: schema.invoices.correctsId,
      advanceType: schema.invoices.advanceType,
      serviceFrom: schema.invoices.serviceFrom,
      serviceTo: schema.invoices.serviceTo,
      treatment: schema.invoices.taxTreatment,
    })
    .from(l)
    .innerJoin(e, eq(e.id, l.entryId))
    .leftJoin(schema.writeOffs, and(eq(e.sourceType, "ausbuchung"), eq(e.sourceId, schema.writeOffs.id)))
    .leftJoin(schema.invoices, or(eq(schema.invoices.id, schema.writeOffs.invoiceId), and(eq(e.sourceType, "invoice"), eq(e.sourceId, schema.invoices.id))))
    .where(and(gte(e.date, start), lt(e.date, end), nurManuell ? eq(e.sourceType, "manuell") : notInArray(e.sourceType, ["eroeffnung", "asset"])))
    .orderBy(asc(e.id));
  const buchungen = new Map<string, { kontenrahmen: Kontenrahmen; versteuerung: Versteuerung; zeilen: JournalZeile[] }>();
  for (const r of rows) {
    let b = buchungen.get(r.id);
    if (!b) {
      // Auch Storno und Korrektur folgen der ursprünglichen Rechnung.
      const mode = r.invoiceDate
        ? await invoiceVatMode(
            {
              issueDate: r.invoiceDate,
              correctsId: r.correctsId,
              advanceType: r.advanceType,
              serviceFrom: r.serviceFrom,
              serviceTo: r.serviceTo,
              taxTreatment: r.treatment ?? "regulaer",
            },
            q,
          )
        : versteuerung;
      b = { kontenrahmen: r.kontenrahmen as Kontenrahmen, versteuerung: mode, zeilen: [] };
      buchungen.set(r.id, b);
    }
    b.zeilen.push({ account: r.account, debit: r.debit, credit: r.credit, taxCode: r.taxCode as JournalZeile["taxCode"], basis: r.basis });
  }
  const summe = leereJournalKennzahlen();
  // Ein Jahr hat einen Kontenrahmen; je Kontenrahmen gerechnet, falls ein Zeitraum doch beide sieht
  for (const kr of ["SKR03", "SKR04"] as const)
    for (const mode of ["ist", "soll"] as const) {
      const eigene = [...buchungen.values()].filter((b) => b.kontenrahmen === kr && b.versteuerung === mode).map((b) => b.zeilen);
      if (eigene.length === 0) continue;
      const k = kennzahlenAusJournal(kr, mode, eigene);
      for (const feld of JOURNAL_KENNZAHLEN) summe[feld] += k[feld];
    }
  return summe;
}
