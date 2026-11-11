import { dauerfristActive, formatEuro, periodLabel, ustVorauszahlungImVorjahr, type Cents, type VatPeriod } from "@haben/core";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { loadDauerfrist } from "../umsatzsteuer/index.ts";
import { buchungen, type Buchung } from "./euer-journal-buchungen.ts";

/*
 * Umsatzsteuer-Vorauszahlung für Dezember bzw. das vierte Quartal, gezahlt vom 1. bis 10. Januar: In der EÜR zählt sie im
 * Vorjahr (§ 11 Abs. 2 Satz 2 EStG, ustVorauszahlungImVorjahr in @haben/core, #583). Beide Wege der EÜR verschieben dieselben
 * Zuordnungen: die Nebenbücher (euerPayments in reports.ts) und das Journal (euer-journal.ts, euer-formel.ts); der Abgleich
 * (abgleich.ts) rechnet die Buchungen ebenso um. Die Buchung selbst behält ihr Datum, Voranmeldung und Konten bleiben gleich.
 *
 * GoBD: Eine übermittelte Anlage EÜR bzw. Einkommensteuererklärung oder ein abgeschlossenes Jahr ändert Haben nicht. War das
 * Vorjahr beim Zuordnen der Zahlung schon übermittelt bzw. abgeschlossen, zählt sie im Jahr der Zahlung, und die Vorprüfung
 * des Zahlungsjahres nennt sie (vorauszahlungVorjahrHinweis). Erklärungen, die Haben vor dieser Regel übermittelt hat, tragen
 * das Kennzeichen ZEHN_TAGE_REGEL nicht; sie enthalten die Zahlung nicht und sperren deshalb unabhängig vom Zeitpunkt.
 */

/** Kennzeichen in den gespeicherten Werten (annual_submissions.figures) einer Anlage EÜR bzw. ESt-Erklärung ab #583 */
export const ZEHN_TAGE_REGEL = "ustVorauszahlungZehnTage";

export interface VorauszahlungImJanuar {
  allocationId: string;
  reversesId: string | null;
  amount: Cents;
  zeitraum: VatPeriod;
  /** Gehört nach § 11 Abs. 2 Satz 2 EStG in das Vorjahr */
  imVorjahr: boolean;
  /** Das Vorjahr war beim Zuordnen schon übermittelt oder abgeschlossen: die Zahlung zählt im Jahr der Zahlung */
  gesperrt: boolean;
}

/** Ab wann ist die EÜR des Jahres gesperrt? Prüft je Zeitpunkt der Zuordnung */
async function sperre(year: number, q: Db | Tx): Promise<(zugeordnet: Date) => boolean> {
  const s = schema.annualSubmissions;
  const gesendet = await q
    .select({ createdAt: s.createdAt, figures: s.figures })
    .from(s)
    .where(and(eq(s.year, year), inArray(s.form, ["euer", "est"]), eq(s.kind, "send"), eq(s.ok, true)));
  const [abschluss] = await q.select({ closedAt: schema.yearClosings.closedAt }).from(schema.yearClosings).where(eq(schema.yearClosings.year, year));
  return (zugeordnet) =>
    gesendet.some((g) => g.figures[ZEHN_TAGE_REGEL] !== true || g.createdAt <= zugeordnet) || (abschluss !== undefined && abschluss.closedAt <= zugeordnet);
}

/** Zahlungen und Erstattungen mit Bezug auf eine Voranmeldung, gebucht vom 1. bis 10. Januar `jahr`, auch aufgehobene */
export async function vorauszahlungenImJanuar(jahr: number, q: Db | Tx): Promise<VorauszahlungImJanuar[]> {
  const a = schema.allocations;
  const t = schema.bankTransactions;
  const v = schema.vatReturns;
  const rows = await q
    .select({
      id: a.id,
      reversesId: a.reversesId,
      amount: a.amount,
      createdAt: a.createdAt,
      bookingDate: t.bookingDate,
      umsatz: t.amount,
      year: v.year,
      month: v.month,
    })
    .from(a)
    .innerJoin(t, eq(t.id, a.transactionId))
    .innerJoin(v, eq(v.id, a.vatReturnId))
    .where(and(eq(a.kind, "ustVorauszahlung"), gte(t.bookingDate, `${jahr}-01-01`), lte(t.bookingDate, `${jahr}-01-10`)));
  if (rows.length === 0) return [];
  const dauerfrist = await loadDauerfrist(q);
  const gesperrt = await sperre(jahr - 1, q);
  return rows.map((r) => {
    const zeitraum = { year: r.year, month: r.month };
    return {
      allocationId: r.id,
      reversesId: r.reversesId,
      amount: r.amount,
      zeitraum,
      // Die Gegenzeile beim Aufheben hängt am selben Umsatz und folgt damit der Zahlung
      imVorjahr: ustVorauszahlungImVorjahr({
        buchungstag: r.bookingDate,
        zeitraum,
        dauerfrist: dauerfristActive(dauerfrist, r.year),
        abfluss: r.umsatz < 0,
      }),
      gesperrt: gesperrt(r.createdAt),
    };
  });
}

export interface EuerVerschiebung {
  /** Zuordnungen aus dem Januar des Folgejahres, die in dieser EÜR zählen */
  herein: Set<string>;
  /** Zuordnungen aus dem Januar dieses Jahres, die in der EÜR des Vorjahres zählen */
  hinaus: Set<string>;
}

const zaehltImVorjahr = (z: VorauszahlungImJanuar) => z.imVorjahr && !z.gesperrt;

/** Welche Zuordnungen die EÜR `year` vom Buchungstag abweichend zählt */
export async function euerVerschiebung(year: number, q: Db | Tx): Promise<EuerVerschiebung> {
  const ids = async (jahr: number) => new Set((await vorauszahlungenImJanuar(jahr, q)).filter(zaehltImVorjahr).map((z) => z.allocationId));
  return { herein: await ids(year + 1), hinaus: await ids(year) };
}

/** Die Buchungen dazu; die hereingenommenen mit Datum 31.12. des Jahres */
export async function verschobeneBuchungen(year: number, q: Db | Tx): Promise<{ herein: Buchung[]; hinaus: Buchung[] }> {
  const { herein, hinaus } = await euerVerschiebung(year, q);
  const e = schema.journalEntries;
  const laden = async (ids: Set<string>) => (ids.size === 0 ? [] : buchungen(q, and(eq(e.sourceType, "allocation"), inArray(e.sourceId, [...ids]))));
  return { herein: (await laden(herein)).map((b) => ({ ...b, date: `${year}-12-31` })), hinaus: await laden(hinaus) };
}

/** Buchungen des Jahres nach Datum (`jahr`), wie sie in der EÜR zählen: ohne die hinaus, mit den herein verschobenen */
export async function imEuerJahr(year: number, jahr: Buchung[], q: Db | Tx): Promise<Buchung[]> {
  const { herein, hinaus } = await verschobeneBuchungen(year, q);
  const raus = new Set(hinaus.map((b) => b.id));
  return [...jahr.filter((b) => !raus.has(b.id)), ...herein];
}

/**
 * Hinweis für die Vorprüfung der EÜR `year`: Vorauszahlungen vom 1. bis 10. Januar, die in das Vorjahr gehörten, dort aber
 * nicht zählen, weil es beim Zuordnen schon übermittelt bzw. abgeschlossen war. Aufgehobene Zuordnungen zählen nicht.
 */
export async function vorauszahlungVorjahrHinweis(year: number, q: Db | Tx = db): Promise<string | null> {
  const alle = await vorauszahlungenImJanuar(year, q);
  const aufgehoben = new Set(alle.flatMap((z) => (z.reversesId ? [z.reversesId] : [])));
  const gesperrt = alle.filter((z) => z.imVorjahr && z.gesperrt && !z.reversesId && !aufgehoben.has(z.allocationId));
  if (gesperrt.length === 0) return null;
  const betrag = formatEuro(-gesperrt.reduce((s, z) => s + z.amount, 0));
  const zeitraeume = [...new Set(gesperrt.map((z) => periodLabel(z.zeitraum)))].join(", ");
  const eine = gesperrt.length === 1;
  return `${eine ? "Die Umsatzsteuer-Vorauszahlung" : `${gesperrt.length} Umsatzsteuer-Vorauszahlungen`} für ${zeitraeume} (${betrag}), gezahlt bis 10. Januar, ${eine ? "gehört" : "gehören"} nach § 11 Abs. 2 Satz 2 EStG in die EÜR ${year - 1}. Die war beim Zuordnen schon übermittelt bzw. abgeschlossen; Haben ändert sie nicht und zählt die Zahlung in ${year}. Kläre mit der Steuerberatung, ob die EÜR ${year - 1} zu berichtigen ist.`;
}
