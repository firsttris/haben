import {
  ACCOUNTS,
  kennzahlenAusJournal,
  monthsOfPeriod,
  type Cents,
  type JournalKennzahl,
  type JournalZeile,
  type Kontenrahmen,
  type VatPeriod,
  type Versteuerung,
} from "@haben/core";
import { and, eq, gte, lt, ne, or, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { invoiceTaxReader } from "../rechnungen/index.ts";
import type { computeVatFigures } from "../umsatzsteuer/index.ts";

/*
 * Abgleich der Bemessungsgrundlagen (#542, Schritt 3): Kennzahlen aus Konto und Steuerschlüssel der Journalzeilen
 * (journal-kennzahlen.ts in @haben/core) gegen die Voranmeldung aus den Nebenbüchern. Die Steuerbeträge vergleicht
 * abgleich.ts schon über die Steuerkonten; hier kommen die Bemessungsgrundlagen dazu.
 *
 * Was das Journal noch nicht trägt, bleibt als benannte Ausnahme draußen, auf beiden Seiten:
 * - Ist-Versteuerung: Kz 81, 86, 43 und 48 meldet die Voranmeldung mit der Zahlung. Die Zahlungsbuchung trägt die
 *   Bemessungsgrundlage erst seit #542 Schritt 4. Kz 81 und 86 vergleicht der Abgleich deshalb nur in Zeiträumen, in denen
 *   jede Umbuchung von „Umsatzsteuer nicht fällig“ eine Bemessungsgrundlage trägt; Kz 43 und 48 bei Ist gar nicht, weil
 *   sich eine ältere Zahlung auf eine steuerfreie Rechnung im Journal nicht von einer ohne Meldung unterscheiden lässt.
 * - Privatnutzung von Fahrzeugen: in der Voranmeldung monatlich, im Journal erst mit der AfA (wie bei der Steuer).
 * - Belege mit § 13b oder innergemeinschaftlichem Erwerb, deren Steuer nicht voll abziehbar ist (Privatanteil, ohne
 *   Vorsteuerabzug): Ältere Buchungen trennen den privaten Teil bzw. die Steuer nicht mit Steuerschlüssel von der
 *   Bemessungsgrundlage (seit #551 schon).
 * - Korrekturen übernommener Lexoffice-Rechnungen: Sie buchen das Netto gegen den Saldenvortrag, ohne Steuerschlüssel.
 */

export interface JournalBuchung {
  month: number;
  kontenrahmen: Kontenrahmen;
  sourceType: (typeof schema.journalEntries.$inferSelect)["sourceType"];
  sourceId: string;
  zeilen: JournalZeile[];
  /** Rechnungen und ihre Ausbuchungen behalten das Verfahren der ursprünglichen Rechnung. */
  versteuerung?: Versteuerung;
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
    .where(and(gte(e.date, from), lt(e.date, to), ne(e.sourceType, "eroeffnung")));
  const byEntry = new Map<string, JournalBuchung>();
  const taxes = invoiceTaxReader(q);
  for (const r of rows) {
    let buchung = byEntry.get(r.id);
    if (!buchung) {
      buchung = {
        month: Number(r.month),
        kontenrahmen: r.kontenrahmen as Kontenrahmen,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        versteuerung: !r.invoiceDate
          ? undefined
          : await taxes.postingMode({
              issueDate: r.invoiceDate!,
              correctsId: r.correctsId,
              advanceType: r.advanceType,
              id: r.invoiceId ?? undefined,
              variant: r.variant,
              serviceFrom: r.serviceFrom,
              serviceTo: r.serviceTo,
              taxTreatment: r.treatment ?? "regulaer",
            }),
        zeilen: [],
      };
      byEntry.set(r.id, buchung);
    }
    buchung.zeilen.push({ account: r.account, debit: r.debit, credit: r.credit, taxCode: r.taxCode, basis: r.basis });
  }
  return [...byEntry.values()];
}

type Figures = Awaited<ReturnType<typeof computeVatFigures>>;

/** Bei Ist: immer verglichen, nur wenn die Zahlungen des Zeitraums ihre Bemessungsgrundlage tragen, oder nie (siehe oben) */
type BeiIst = "immer" | "mitBasis" | "nie";

const POSTEN: { feld: JournalKennzahl; posten: string; beiIst: BeiIst }[] = [
  { feld: "kz81", posten: "Bemessungsgrundlage 19 % (Kz 81)", beiIst: "mitBasis" },
  { feld: "kz86", posten: "Bemessungsgrundlage 7 % (Kz 86)", beiIst: "mitBasis" },
  { feld: "kz21", posten: "Reverse Charge, Leistung ins EU-Ausland (Kz 21)", beiIst: "immer" },
  { feld: "kz41", posten: "Innergemeinschaftliche Lieferung (Kz 41)", beiIst: "immer" },
  { feld: "kz43", posten: "Ausfuhrlieferung (Kz 43)", beiIst: "nie" },
  { feld: "kz45", posten: "Übrige nicht im Inland steuerbare Umsätze (Kz 45)", beiIst: "immer" },
  { feld: "kz48", posten: "Steuerfrei ohne Vorsteuerabzug (Kz 48)", beiIst: "nie" },
  { feld: "kz46", posten: "Bemessungsgrundlage § 13b EU-Ausland (Kz 46)", beiIst: "immer" },
  { feld: "kz84", posten: "Bemessungsgrundlage § 13b Drittland (Kz 84)", beiIst: "immer" },
  { feld: "kz89", posten: "Innergemeinschaftlicher Erwerb 19 % (Kz 89)", beiIst: "immer" },
  { feld: "kz93", posten: "Innergemeinschaftlicher Erwerb 7 % (Kz 93)", beiIst: "immer" },
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
  // Korrekturen übernommener Lexoffice-Rechnungen: Rechnungsbuchung gegen den Saldenvortrag, bis #542 ohne Steuerschlüssel;
  // seitdem trägt die Zeile bei Soll den Steuerschlüssel und wird verglichen
  const korrekturen = new Set(
    imZeitraum
      .filter((b) => b.sourceType === "invoice" && b.zeilen.some((z) => z.account === ACCOUNTS[b.kontenrahmen].saldenvortrag && z.taxCode === null))
      .map((b) => b.sourceId),
  );
  const ausgenommen = (b: JournalBuchung) =>
    b.sourceType === "asset" ||
    (b.sourceType === "document" && ausgenommeneBelege.has(b.sourceId)) ||
    (b.sourceType === "invoice" && korrekturen.has(b.sourceId));

  const journal = new Map<JournalKennzahl, Cents>();
  for (const kr of ["SKR03", "SKR04"] as const)
    for (const mode of ["ist", "soll"] as const) {
      const eigene = imZeitraum.filter((b) => b.kontenrahmen === kr && (b.versteuerung ?? figures.versteuerung) === mode && !ausgenommen(b));
      if (eigene.length === 0) continue;
      const k = kennzahlenAusJournal(
        kr,
        mode,
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

  // Bei Ist: Trägt jede Umbuchung der Umsatzsteuer bei Zahlung ihre Bemessungsgrundlage? Ältere tun es nicht.
  const umbuchungOhneBasis = imZeitraum.some((b) => {
    const a = ACCOUNTS[b.kontenrahmen];
    const nichtFaellig = new Set<string>(Object.values(a.ustNichtFaellig));
    const ust = new Set<string>(Object.values(a.ust));
    return b.zeilen.some((z) => nichtFaellig.has(z.account)) && b.zeilen.some((z) => ust.has(z.account) && z.basis == null);
  });
  const verglichen = ({ beiIst }: { beiIst: BeiIst }) =>
    figures.versteuerung === "soll" || beiIst === "immer" || (beiIst === "mitBasis" && !umbuchungOhneBasis);
  return POSTEN.filter(verglichen).map(({ feld, posten }) => ({
    posten,
    journal: journal.get(feld) ?? 0,
    quelle: quelle.get(feld) ?? 0,
  }));
}
