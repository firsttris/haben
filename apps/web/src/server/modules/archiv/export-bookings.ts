import { ASSET_KINDS, ASSET_METHODS, formatDegressiveRate, PAUSCHALE_LABEL } from "@haben/core";
import { and, asc, between, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { cashBookCsv } from "../bank/index.ts";
import { accountName, listAssets, openingCash } from "../buchhaltung/index.ts";
import { csv, type CsvValue, iso, money } from "./csv.ts";
import type { ArchiveFile } from "./export-zip.ts";
import { groupBy } from "./group-by.ts";
import { yearEnd, yearStart } from "./jahr.ts";

// Journal, Anlagenverzeichnis, Pauschalen und Kassenbuch des Jahresarchivs

const encoder = new TextEncoder();

/** Herkunft einer Buchung im Journal, wie sie die Datenbank zulässt */
type JournalSource = (typeof schema.journalEntries.$inferInsert)["sourceType"];
const SOURCE_LABELS: Record<JournalSource, string> = {
  // Eigene Buchung neben dem Beleg, wenn dessen Leistung beim Buchen noch nicht ausgeführt war (#693)
  freigabe: "Vorsteuerfreigabe",
  invoice: "Rechnung",
  document: "Beleg",
  allocation: "Zahlung",
  asset: "Anlage",
  pauschale: "Pauschale",
  kasse: "Kasse",
  ausbuchung: "Ausbuchung",
  manuell: "Manuell",
  eroeffnung: "Eröffnung",
  ausschuettung: "Ausschüttung",
  lohn: "Lohn",
  import: "Import",
  verrechnung: "Verrechnung",
};

/**
 * Herkunft einer Journalbuchung für die Spalte „Quelle“. Die Zuordnung deckt jeden Wert ab, den das Schema zulässt;
 * eine Herkunft aus einem älteren Stand bleibt roh statt leer.
 */
export function sourceLabel(sourceType: string): string {
  return SOURCE_LABELS[sourceType as JournalSource] ?? sourceType;
}

/** Buchungen, Anlagen, Pauschalen (Eigenbelege) und Kassenbuch des Jahres */
export async function* bookingFiles(year: number): AsyncGenerator<ArchiveFile> {
  yield await journalFile(year);
  yield await assetsFile(year);
  const pauschalen = await pauschalenFile(year);
  if (pauschalen) yield pauschalen;
  // Kassenbuch: mit Anfangsbestand und Bestand nach jeder Zeile; auch wenn nur die Eröffnung einen Bestand bringt
  if ((await db.select({ id: schema.cashEntries.id }).from(schema.cashEntries).limit(1)).length > 0 || (await openingCash()).length > 0) {
    yield { path: "kasse/kassenbuch.csv", content: encoder.encode(await cashBookCsv(year)), compress: true };
  }
}

/** buchungen/journal.csv: je Zeile einer Buchung des Jahres eine Zeile */
async function journalFile(year: number): Promise<ArchiveFile> {
  const entries = await db
    .select()
    .from(schema.journalEntries)
    .where(and(gte(schema.journalEntries.date, yearStart(year)), lte(schema.journalEntries.date, yearEnd(year))))
    .orderBy(asc(schema.journalEntries.date), asc(schema.journalEntries.createdAt), asc(schema.journalEntries.id));
  const journalLines = entries.length
    ? await db
        .select()
        .from(schema.journalLines)
        .where(
          inArray(
            schema.journalLines.entryId,
            entries.map((e) => e.id),
          ),
        )
        .orderBy(asc(schema.journalLines.credit), asc(schema.journalLines.account))
    : [];
  const linesByEntry = groupBy(journalLines, (l) => l.entryId);
  const journalRows: CsvValue[][] = entries.flatMap((entry) =>
    (linesByEntry.get(entry.id) ?? []).map((line) => [
      entry.date,
      entry.id,
      entry.description,
      sourceLabel(entry.sourceType),
      entry.sourceId,
      entry.kontenrahmen,
      line.account,
      accountName(entry.kontenrahmen, line.account),
      line.debit ? money(line.debit) : "",
      line.credit ? money(line.credit) : "",
      line.taxCode,
      line.basis === null ? "" : money(line.basis),
      entry.reversesId,
      iso(entry.lockedAt),
      iso(entry.createdAt),
    ]),
  );
  return {
    path: "buchungen/journal.csv",
    content: csv(
      [
        "Datum",
        "Buchungs-ID",
        "Beschreibung",
        "Quelle",
        "Quell-ID",
        "Kontenrahmen",
        "Konto",
        "Kontoname",
        "Soll",
        "Haben",
        "Steuerschlüssel",
        "Bemessungsgrundlage",
        "Gegenbuchung zu",
        "Festgeschrieben",
        "Erfasst",
      ],
      journalRows,
    ),
    compress: true,
  };
}

/** anlagen/anlagenverzeichnis.csv */
async function assetsFile(year: number): Promise<ArchiveFile> {
  const assetRows: CsvValue[][] = (await listAssets(year))
    // auch voll abgeschriebene Fahrzeuge, die noch privat genutzt werden
    .filter((a) => a.year !== null || (a.privateUseYear?.months.length ?? 0) > 0)
    .map((a) => [
      a.name,
      ASSET_KINDS[a.kind].label,
      ASSET_METHODS[a.method],
      a.account,
      a.acquisitionDate,
      money(a.cost),
      a.usefulLifeMonths,
      // Verzeichnis nach § 7a Abs. 8 EStG für die degressive AfA: Satz und Wechsel zur linearen
      a.degressiveRate === null ? "" : formatDegressiveRate(a.degressiveRate),
      a.linearFromYear,
      a.memoValue,
      a.openingDate,
      a.openingBookValue === null ? "" : money(a.openingBookValue),
      money(a.year?.opening ?? 0),
      money(a.year?.addition ?? 0),
      money(a.year?.depreciation ?? 0),
      money(a.year?.disposal ?? 0),
      money(a.year?.closing ?? 0),
      a.disposalDate,
      a.privateUse ? `${a.privateUse.rate / 100} %`.replace(".", ",") : "",
      a.privateUse ? money(a.privateUse.listPrice) : "",
      a.privateUseYear ? money(a.privateUseYear.withdrawal) : "",
      a.privateUseYear ? money(a.privateUseYear.vat) : "",
      a.bookedYears.includes(year),
      a.documentId,
      a.id,
    ]);
  return {
    path: "anlagen/anlagenverzeichnis.csv",
    content: csv(
      [
        "Bezeichnung",
        "Art",
        "Abschreibung",
        "Anlagekonto",
        "Anschaffung",
        "Anschaffungskosten",
        "Nutzungsdauer (Monate)",
        "Degressiver Satz",
        "Linear ab",
        "Erinnerungswert",
        "Übernommen zum",
        "Buchwert bei Übernahme",
        "Buchwert Jahresanfang",
        "Zugang",
        "AfA",
        "Abgang (Restbuchwert)",
        "Buchwert Jahresende",
        "Abgangsdatum",
        "Privatnutzung Satz",
        "Bruttolistenpreis",
        "Privatnutzung Entnahme",
        "Privatnutzung Umsatzsteuer",
        "AfA gebucht",
        "Beleg-ID",
        "ID",
      ],
      assetRows,
    ),
    compress: true,
  };
}

/** pauschalen/pauschalen.csv; null ohne Pauschale im Jahr */
async function pauschalenFile(year: number): Promise<ArchiveFile | null> {
  const pauschalen = await db
    .select()
    .from(schema.pauschalen)
    .where(between(schema.pauschalen.date, yearStart(year), yearEnd(year)))
    .orderBy(asc(schema.pauschalen.date), asc(schema.pauschalen.createdAt), asc(schema.pauschalen.id));
  if (pauschalen.length === 0) return null;
  return {
    path: "pauschalen/pauschalen.csv",
    content: csv(
      ["Datum", "Art", "Beschreibung", "Angaben", "Betrag", "Storno von", "Buchungs-ID", "Erfasst", "ID"],
      pauschalen.map((p) => [
        p.date,
        PAUSCHALE_LABEL[p.art],
        p.description,
        JSON.stringify(p.details),
        money(p.amount),
        p.reversesId,
        p.journalEntryId,
        p.createdAt.toISOString(),
        p.id,
      ]),
    ),
    compress: true,
  };
}
