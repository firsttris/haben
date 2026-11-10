import {
  dauerfristActive,
  dueDate,
  formatEuro,
  ohneAltbestand,
  schonfristEnde,
  type Cents,
  type OpenItem,
  type VatPayment,
  type VatPostenStand,
  vatPosten,
  vatPostenLabel,
  vatPostenStand,
} from "@haben/core";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { today } from "../../today.ts";
import { loadDauerfrist } from "./dauerfrist.ts";
import { VatError } from "./vat.ts";

/*
 * Voranmeldung als offener Posten (@haben/core ustva-posten.ts): Jede abgegebene Voranmeldung, über ERiC oder vermerkt,
 * ist ein Posten über ihre Zahllast (Kz 83) bzw. Erstattung, eine berichtigte über die Differenz. Bezahlt wird im
 * Bankabgleich mit „Umsatzsteuer an das Finanzamt“ (SKR03 1780, SKR04 3820) und dem Bezug auf die Voranmeldung.
 */

export interface UstvaPostenUebersicht {
  posten: VatPostenStand[];
  /** Zahlungen an das bzw. vom Finanzamt ohne Bezug, die keinen Posten genau ausgleichen */
  ohneBezug: VatPayment[];
}

/** Abgegebene Voranmeldungen mit dem Tag der Abgabe: vermerkt der eingetragene, über ERiC der Tag der Übermittlung */
async function filedReturns(q: Db | Tx) {
  const rows = await q
    .select({
      id: schema.vatReturns.id,
      year: schema.vatReturns.year,
      month: schema.vatReturns.month,
      kz83: schema.vatReturns.kz83,
      correctsId: schema.vatReturns.correctsId,
      sentAt: schema.vatReturns.sentAt,
      filedOn: schema.vatReturnFilings.filedOn,
    })
    .from(schema.vatReturns)
    .leftJoin(schema.vatReturnFilings, eq(schema.vatReturnFilings.vatReturnId, schema.vatReturns.id))
    .where(eq(schema.vatReturns.status, "sent"));
  return rows.map((r) => ({ ...r, abgabeTag: r.filedOn ?? today(r.sentAt!) }));
}

/**
 * Wirksame Zahlungen „Umsatzsteuer an das Finanzamt“: aufgehobene Zuordnungen und ihre Gegenzeilen fallen weg, so
 * gleicht eine aufgehobene Lastschrift keinen Posten aus.
 */
async function vatPayments(q: Db | Tx): Promise<VatPayment[]> {
  const a = schema.allocations;
  const rows = await q
    .select({ id: a.id, vatReturnId: a.vatReturnId, amount: a.amount, bookingDate: schema.bankTransactions.bookingDate })
    .from(a)
    .innerJoin(schema.bankTransactions, eq(schema.bankTransactions.id, a.transactionId))
    .where(and(eq(a.kind, "ustVorauszahlung"), isNull(a.reversesId), sql`not exists (select 1 from allocations r where r.reverses_id = ${a.id})`));
  return rows;
}

/**
 * Voranmeldungen, die vor dem Stichtag der offenen Posten (vat_items_since, gesetzt von Migration 0138) gesendet wurden.
 * Ohne Stichtag (nicht zu erwarten, die Zeile ist nur anhängbar) gibt es keinen Altbestand.
 */
async function altbestand(q: Db | Tx, returns: { id: string; sentAt: Date | null }[]): Promise<Set<string>> {
  const [row] = await q.select({ since: schema.vatItemsSince.since }).from(schema.vatItemsSince);
  if (!row) return new Set();
  return new Set(returns.filter((r) => r.sentAt !== null && r.sentAt < row.since).map((r) => r.id));
}

/**
 * Stand aller Posten: Betrag, Fälligkeit, Zahlungen und was offen ist. Altbestand ohne Zahlung mit Bezug fehlt
 * (ohneAltbestand); `mitAltbestand` nimmt ihn für eine ausdrückliche Zuordnung mit Bezug dazu.
 */
export async function ustvaPosten(q: Db | Tx = db, { mitAltbestand = false } = {}): Promise<UstvaPostenUebersicht> {
  // Nacheinander: in einer Transaktion teilen sich die Abfragen eine Verbindung
  const returns = await filedReturns(q);
  const payments = await vatPayments(q);
  const company = await loadCompany(q);
  const dauerfrist = await loadDauerfrist(q);
  const alle = vatPosten(returns, (period) => dueDate(period, company.bundesland, dauerfristActive(dauerfrist, period.year)));
  const posten = mitAltbestand ? alle : ohneAltbestand(alle, await altbestand(q, returns), payments);
  return vatPostenStand(posten, payments);
}

/** Posten eines Zeitraums, für die Seite der Voranmeldung */
export async function ustvaPostenForPeriod(period: { year: number; month: number }): Promise<VatPostenStand[]> {
  return (await ustvaPosten()).posten.filter((p) => p.year === period.year && p.month === period.month);
}

/** Offene Posten für den Bankabgleich, mit dem Vorzeichen der Zahlung: Zahllast als Ausgang, Erstattung als Eingang */
export async function ustvaOpenItems(): Promise<OpenItem[]> {
  const { posten } = await ustvaPosten();
  // Feiertage für das Ende der Schonfrist (§ 108 Abs. 3 AO) wie für die Fälligkeit: die im Bundesland des Finanzamts
  const { bundesland } = await loadCompany();
  return posten
    .filter((p) => p.offen !== 0)
    .map((p) => ({
      type: "ustva" as const,
      id: p.vatReturnId,
      number: `${vatPostenLabel(p)}${p.berichtigt ? " (Berichtigung)" : ""}`,
      date: p.faellig,
      dueDate: p.faellig,
      open: -p.offen,
      partyName: "Finanzamt",
      partyIbans: [],
      period: { year: p.year, month: p.month },
      schonfristEnde: schonfristEnde(p.faellig, bundesland),
    }));
}

/**
 * Prüft in der buchenden Transaktion, dass die Zahlung zum offenen Posten passt: gleiche Richtung, höchstens der offene
 * Betrag. Die Voranmeldung wird gesperrt (FOR UPDATE ändert nichts, der Trigger der Festschreibung greift also nicht),
 * damit zwei gleichzeitige Zuordnungen denselben Posten nicht überzahlen.
 */
export async function assertUstvaOffen(tx: Tx, vatReturnId: string, amount: Cents): Promise<string> {
  const [locked] = await tx
    .select({ id: schema.vatReturns.id, status: schema.vatReturns.status })
    .from(schema.vatReturns)
    .where(eq(schema.vatReturns.id, vatReturnId))
    .for("update");
  if (locked?.status !== "sent") throw new VatError("Die Voranmeldung ist nicht abgegeben; zuordnen lässt sich nur eine gesendete oder vermerkte.");
  const posten = (await ustvaPosten(tx, { mitAltbestand: true })).posten.find((p) => p.vatReturnId === vatReturnId);
  const label = posten ? vatPostenLabel(posten) : "Die Voranmeldung";
  // Zahlung mit dem Vorzeichen des Kontos: Ausgang (negativ) für eine Zahllast (positiv)
  if (!posten || posten.offen === 0) throw new VatError(`${label} ist schon ausgeglichen.`);
  if (Math.sign(-amount) !== Math.sign(posten.offen)) {
    throw new VatError(
      posten.offen > 0
        ? `${label} ist eine Zahllast; zuordnen lässt sich nur ein Ausgang.`
        : `${label} ist eine Erstattung; zuordnen lässt sich nur ein Eingang.`,
    );
  }
  if (Math.abs(amount) > Math.abs(posten.offen)) throw new VatError(`${label} ist nur noch über ${formatEuro(Math.abs(posten.offen))} offen.`);
  return label;
}

/** Bezeichnungen der Voranmeldungen, auf die sich Zuordnungen beziehen, für die Anzeige im Bankabgleich */
export async function ustvaLabels(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.vatReturns.id, year: schema.vatReturns.year, month: schema.vatReturns.month, berichtigt: schema.vatReturns.berichtigt })
    .from(schema.vatReturns)
    .where(inArray(schema.vatReturns.id, ids));
  return new Map(rows.map((r) => [r.id, `${vatPostenLabel(r)}${r.berichtigt ? " (Berichtigung)" : ""}`]));
}
