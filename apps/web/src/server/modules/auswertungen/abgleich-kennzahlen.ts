import {
  ACCOUNTS,
  kennzahlenAusJournal,
  monthsOfPeriod,
  type Cents,
  type JournalKennzahl,
  type JournalZeile,
  type Kontenrahmen,
  type VatPeriod,
} from "@haben/core";
import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import type { computeVatFigures } from "../umsatzsteuer/index.ts";

/*
 * Abgleich der Bemessungsgrundlagen (#542, Schritt 3): Kennzahlen aus Konto und Steuerschlüssel der Journalzeilen
 * (journal-kennzahlen.ts in @haben/core) gegen die Voranmeldung aus den Nebenbüchern. Die Steuerbeträge vergleicht
 * abgleich.ts schon über die Steuerkonten; hier kommen die Bemessungsgrundlagen dazu.
 *
 * Was das Journal noch nicht trägt, bleibt als benannte Ausnahme draußen, auf beiden Seiten:
 * - Ist-Versteuerung: Kz 81, 86, 43 und 48 meldet die Voranmeldung mit der Zahlung, an der Zahlungsbuchung fehlt die
 *   Bemessungsgrundlage noch (#542, Schritt 4). Verglichen werden bei Ist nur die Kennzahlen nach Rechnungs- bzw. Belegdatum.
 * - Privatnutzung von Fahrzeugen: in der Voranmeldung monatlich, im Journal erst mit der AfA (wie bei der Steuer).
 * - Belege mit § 13b oder innergemeinschaftlichem Erwerb, deren Steuer nicht voll abziehbar ist (Privatanteil, ohne
 *   Vorsteuerabzug): Das Journal trennt den privaten Teil bzw. die Steuer nicht mit Steuerschlüssel von der Bemessungsgrundlage.
 * - Korrekturen übernommener Lexoffice-Rechnungen: Sie buchen das Netto gegen den Saldenvortrag, ohne Steuerschlüssel.
 */

export interface JournalBuchung {
  month: number;
  kontenrahmen: Kontenrahmen;
  sourceType: (typeof schema.journalEntries.$inferSelect)["sourceType"];
  sourceId: string;
  zeilen: JournalZeile[];
}

/** Alle Buchungen eines Jahres mit ihren Zeilen, ohne Eröffnungen (sie gehören zum Vorjahr, siehe abgleich.ts) */
export async function journalBuchungen(from: string, to: string, q: Db | Tx = db): Promise<JournalBuchung[]> {
  const e = schema.journalEntries;
  const l = schema.journalLines;
  const rows = await q
    .select({
      id: e.id,
      month: sql<number>`extract(month from ${e.date})::int`,
      kontenrahmen: e.kontenrahmen,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      account: l.account,
      debit: l.debit,
      credit: l.credit,
      taxCode: l.taxCode,
    })
    .from(l)
    .innerJoin(e, eq(e.id, l.entryId))
    .where(and(gte(e.date, from), lt(e.date, to), ne(e.sourceType, "eroeffnung")));
  const byEntry = new Map<string, JournalBuchung>();
  for (const r of rows) {
    const buchung = byEntry.get(r.id) ?? {
      month: Number(r.month),
      kontenrahmen: r.kontenrahmen as Kontenrahmen,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      zeilen: [],
    };
    buchung.zeilen.push({ account: r.account, debit: r.debit, credit: r.credit, taxCode: r.taxCode });
    byEntry.set(r.id, buchung);
  }
  return [...byEntry.values()];
}

type Figures = Awaited<ReturnType<typeof computeVatFigures>>;

const POSTEN: { feld: JournalKennzahl; posten: string; beiIst: boolean }[] = [
  { feld: "kz81", posten: "Bemessungsgrundlage 19 % (Kz 81)", beiIst: false },
  { feld: "kz86", posten: "Bemessungsgrundlage 7 % (Kz 86)", beiIst: false },
  { feld: "kz21", posten: "Reverse Charge, Leistung ins EU-Ausland (Kz 21)", beiIst: true },
  { feld: "kz41", posten: "Innergemeinschaftliche Lieferung (Kz 41)", beiIst: true },
  { feld: "kz43", posten: "Ausfuhrlieferung (Kz 43)", beiIst: false },
  { feld: "kz45", posten: "Leistung ins Drittland, nicht steuerbar (Kz 45)", beiIst: true },
  { feld: "kz48", posten: "Steuerfrei ohne Vorsteuerabzug (Kz 48)", beiIst: false },
  { feld: "kz46", posten: "Bemessungsgrundlage § 13b EU-Ausland (Kz 46)", beiIst: true },
  { feld: "kz84", posten: "Bemessungsgrundlage § 13b Drittland (Kz 84)", beiIst: true },
  { feld: "kz89", posten: "Innergemeinschaftlicher Erwerb 19 % (Kz 89)", beiIst: true },
  { feld: "kz93", posten: "Innergemeinschaftlicher Erwerb 7 % (Kz 93)", beiIst: true },
];

/** Bemessungsgrundlagen eines Zeitraums: Journal gegen Nebenbuch, ohne die benannten Ausnahmen (siehe oben) */
export function bemessungsZeilen(
  period: VatPeriod,
  buchungen: readonly JournalBuchung[],
  figures: Figures,
): { posten: string; journal: Cents; quelle: Cents }[] {
  const months = new Set(monthsOfPeriod(period).map((m) => m.month));
  const imZeitraum = buchungen.filter((b) => months.has(b.month));

  // Belege mit § 13b oder Erwerb, deren Steuer nicht voll abziehbar ist
  const teilweise = [...figures.reverseCharge, ...figures.igErwerb].filter((s) => s.deductible !== s.tax);
  const ausgenommeneBelege = new Set(teilweise.map((s) => s.documentId));
  // Korrekturen übernommener Lexoffice-Rechnungen: Rechnungsbuchung gegen den Saldenvortrag
  const korrekturen = new Set(
    imZeitraum.filter((b) => b.sourceType === "invoice" && b.zeilen.some((z) => z.account === ACCOUNTS[b.kontenrahmen].saldenvortrag)).map((b) => b.sourceId),
  );
  const ausgenommen = (b: JournalBuchung) =>
    b.sourceType === "asset" ||
    (b.sourceType === "document" && ausgenommeneBelege.has(b.sourceId)) ||
    (b.sourceType === "invoice" && korrekturen.has(b.sourceId));

  const journal = new Map<JournalKennzahl, Cents>();
  for (const kr of ["SKR03", "SKR04"] as const) {
    const eigene = imZeitraum.filter((b) => b.kontenrahmen === kr && !ausgenommen(b));
    if (eigene.length === 0) continue;
    const k = kennzahlenAusJournal(
      kr,
      figures.versteuerung,
      eigene.map((b) => b.zeilen),
    );
    for (const { feld } of POSTEN) journal.set(feld, (journal.get(feld) ?? 0) + k[feld]);
  }

  // Nebenbuch ohne dieselben Ausnahmen
  const quelle = new Map<JournalKennzahl, Cents>(POSTEN.map(({ feld }) => [feld, figures[feld as keyof Figures] as Cents]));
  const minus = (feld: JournalKennzahl, betrag: Cents) => quelle.set(feld, (quelle.get(feld) ?? 0) - betrag);
  for (const r of figures.revenue) {
    if (r.type === "entnahme" && r.rate === 1900) minus("kz81", r.base);
    // Nur 19 % und 7 %: eine übernommene Rechnung zu 0 % steht in keiner der beiden Kennzahlen
    if (r.type === "invoice" && korrekturen.has(r.invoiceId) && r.treatment === "regulaer" && (r.rate === 1900 || r.rate === 700))
      minus(r.rate === 1900 ? "kz81" : "kz86", r.base);
  }
  for (const s of figures.reverseCharge) if (ausgenommeneBelege.has(s.documentId)) minus(s.reverseCharge === "eu" ? "kz46" : "kz84", s.base);
  for (const s of figures.igErwerb) if (ausgenommeneBelege.has(s.documentId)) minus(s.rate === 1900 ? "kz89" : "kz93", s.base);

  return POSTEN.filter(({ beiIst }) => figures.versteuerung === "soll" || beiIst).map(({ feld, posten }) => ({
    posten,
    journal: journal.get(feld) ?? 0,
    quelle: quelle.get(feld) ?? 0,
  }));
}
