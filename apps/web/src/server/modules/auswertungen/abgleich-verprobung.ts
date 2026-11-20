import { formatEuro, monthsOfPeriod, verprobeBuchung, type Cents, type JournalZeile, type Kontenrahmen, type VatPeriod, type Versteuerung } from "@haben/core";
import { and, eq, gte, lt, ne, or, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { invoiceTaxReader } from "../rechnungen/index.ts";
import { belegAusAlterVersion, belegeWieHeute, zahlungenWieHeute } from "../umsatzsteuer/index.ts";

/*
 * Umsatzsteuer-Verprobung im Journal (#1116, verprobeBuchung in @haben/core): je Buchung die Steuer auf den Steuerkonten
 * gegen Bemessungsgrundlage mal Satz aus Konto und Steuerschlüssel. Ohne Eröffnungen (im Vorjahr angemeldet) und ohne die
 * Buchungen des Anlagenverzeichnisses: Die Privatnutzung von Fahrzeugen trägt an der Erlöszeile keinen Steuerschlüssel,
 * wenn die Bemessungsgrundlage der Umsatzsteuer von der Entnahme abweicht (Hybrid- und Elektroautos, privateUsePosting).
 *
 * Die Vorsteuer eines Belegs bucht Haben so, wie sie auf dem Beleg steht; dass die Buchung dem Beleg folgt, prüft „Vorgang
 * gegen Buchung“. Weicht sie von Netto mal Satz ab, hat meist der Lieferant je Position gerundet. Das ist ein Hinweis zum
 * Prüfen, keine Abweichung im Journal: Abziehbar ist nur die gesetzlich geschuldete Steuer (UStAE 15.2 Abs. 1, § 14c UStG),
 * bei einer E-Rechnung zählen die Werte aus dem XML (EN 16931 BR-CO-17 lässt einen Cent je Satz zu).
 */

export interface JournalBuchung {
  id: string;
  date: string;
  description: string;
  month: number;
  kontenrahmen: Kontenrahmen;
  sourceType: (typeof schema.journalEntries.$inferSelect)["sourceType"];
  sourceId: string;
  zeilen: JournalZeile[];
  /** Belegbuchung aus einer Version vor dem Update auf das Journal (belegAusAlterVersion) */
  alt: boolean;
  /** Rechnungen und ihre Ausbuchungen behalten das Verfahren der ursprünglichen Rechnung. */
  versteuerung?: Versteuerung;
}

/**
 * Alle Buchungen eines Zeitraums mit ihren Zeilen, ohne Eröffnungen (sie gehören zum Vorjahr); Belege von vor #551 und
 * Zahlungen von vor #552 mit der Bemessungsgrundlage wie heute
 */
export async function journalBuchungen(from: string, to: string, q: Db | Tx = db): Promise<JournalBuchung[]> {
  const e = schema.journalEntries;
  const l = schema.journalLines;
  const rows = await q
    .select({
      id: e.id,
      date: e.date,
      description: e.description,
      month: sql<number>`extract(month from ${e.date})::int`,
      kontenrahmen: e.kontenrahmen,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
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
    .where(and(gte(e.date, from), lt(e.date, to), ne(e.sourceType, "eroeffnung")));
  const byEntry = new Map<string, JournalBuchung>();
  const taxes = invoiceTaxReader(q);
  for (const r of rows) {
    let buchung = byEntry.get(r.id);
    if (!buchung) {
      buchung = {
        id: r.id,
        date: r.date,
        description: r.description,
        month: Number(r.month),
        kontenrahmen: r.kontenrahmen as Kontenrahmen,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        alt: r.alt === true,
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
  // Belege mit § 13b oder Erwerb von vor #551 (#1396) und Zahlungen bei Ist von vor #552 (#1502) mit der
  // Bemessungsgrundlage wie heute
  return belegeWieHeute(await zahlungenWieHeute([...byEntry.values()], q), q);
}

const ART = { umsatzsteuer: "Umsatzsteuer", erwerbsteuer: "Erwerbsteuer", vorsteuer: "Vorsteuer" } as const;

const datum = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

/**
 * Abweichungen der Verprobung in den Buchungen eines Zeitraums, je Buchung und Satz eine Zeile; `beleg`: Vorsteuer eines
 * Belegs, nur ein Hinweis (siehe oben)
 */
export function verprobungsZeilen(
  period: VatPeriod,
  buchungen: readonly JournalBuchung[],
  versteuerung: Versteuerung,
): { posten: string; schluessel: string; journal: Cents; erwartet: Cents; beleg: boolean }[] {
  const months = new Set(monthsOfPeriod(period).map((m) => m.month));
  return buchungen
    .filter((b) => months.has(b.month) && b.sourceType !== "asset")
    .flatMap((b) =>
      // Belege und Zahlungen alter Versionen liest journalBuchungen schon mit der Bemessungsgrundlage wie heute
      verprobeBuchung(b.kontenrahmen, b.versteuerung ?? versteuerung, b.zeilen).map((a) => ({
        posten: `${ART[a.art]} ${a.satz / 100} % zur Bemessungsgrundlage ${formatEuro(a.bemessung)}: Buchung „${b.description}“ vom ${datum(b.date)}`,
        schluessel: `buchung:${b.id}:${a.art}:${a.satz}`,
        journal: a.steuer,
        erwartet: a.erwartet,
        beleg: a.art === "vorsteuer" && b.sourceType === "document",
      })),
    );
}

/** Hinweis zur Vorsteuer eines Belegs, die von Netto mal Satz abweicht */
export function belegVorsteuerHinweis(z: { posten: string; journal: Cents; erwartet: Cents }): string {
  const anfang = `Bitte prüfen: ${z.posten} trägt ${formatEuro(z.journal)}, Netto mal Satz wären ${formatEuro(z.erwartet)}.`;
  // Dem Betrag nach mehr: über das Geschuldete hinaus ist nichts abziehbar; weniger: abziehbar ist nur, was ausgewiesen ist
  const mehr = Math.abs(z.journal) > Math.abs(z.erwartet);
  const regel = mehr
    ? "Abziehbar ist nur die gesetzlich geschuldete Steuer (UStAE 15.2 Abs. 1); weist der Lieferant mehr aus, etwa weil er je Position rundet, schuldet er den Mehrbetrag (§ 14c UStG)."
    : "Abziehbar ist nur die in der Rechnung ausgewiesene Steuer (§ 15 Abs. 1 Satz 1 Nr. 1 UStG); die Buchung folgt dem Beleg, mehr ist nicht abziehbar. Steht auf dem Beleg mehr, als erfasst ist, den Beleg berichtigen.";
  return `${anfang} ${regel} Bei einer E-Rechnung zählen die Werte aus dem XML.`;
}
