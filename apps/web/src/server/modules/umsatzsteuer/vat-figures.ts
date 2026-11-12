import {
  bareinnahmeAnteil,
  kategorieAnteil,
  kategorieArt,
  lastMonthOfPeriod,
  monthsOfPeriod,
  paidTaxShares,
  periodRange,
  recordedTaxShares,
  splitPrivateShare,
  type Cents,
  type TaxTreatment,
  type VatPeriod,
  JOURNAL_KENNZAHLEN,
  type JournalKennzahlen,
} from "@haben/core";
import { and, eq, gte, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { privateUseForMonth } from "../buchhaltung/index.ts";
import { journalAbJahr, kleinunternehmerForMonth } from "../stammdaten/index.ts";
import { gutschriftAnteile } from "./gutschrift.ts";
import { kennzahlenAusDemJournal } from "./vat-journal.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { bankAccountIncludedSql, bankOpenAmountSql } from "../../db/bank-open.ts";
import { advanceVatPlans, invoiceTaxReader, invoiceTotalsById } from "../rechnungen/index.ts";

export interface RevenueSource {
  /**
   * payment = Zahlungseingang (Ist), invoice = Rechnung (Soll), entnahme = private Kfz-Nutzung, ausbuchung = Skonto oder
   * Forderungsausfall (§ 17), direkt = Bankumsatz direkt auf eine Einnahmekategorie gebucht (Ist und Soll), kasse =
   * Bareinnahme ohne Rechnung im Kassenbuch (Ist und Soll)
   */
  type: "payment" | "invoice" | "entnahme" | "ausbuchung" | "direkt" | "kasse";
  /** Bei Entnahmen: das Fahrzeug */
  assetId?: string;
  /** Bei Direktbuchungen: der Bankumsatz */
  transactionId?: string;
  /** Bei Bareinnahmen ohne Rechnung: die Zeile im Kassenbuch */
  cashEntryId?: string;
  date: string;
  invoiceId: string;
  number: string;
  customer: string;
  treatment: TaxTreatment;
  rate: number;
  base: Cents;
  tax: Cents;
}

export interface InputTaxSource {
  documentId: string;
  date: string;
  supplier: string;
  number: string;
  rate: number;
  base: Cents;
  tax: Cents;
}

/** Beleg, bei dem du die Steuer als Leistungsempfänger schuldest (§ 13b UStG) */
export interface ReverseChargeSource extends InputTaxSource {
  reverseCharge: "eu" | "drittland";
  /** Davon als Vorsteuer abziehbar (Kz 67): betrieblicher Teil, bei Kleinunternehmern 0 */
  deductible: Cents;
}

/** Beleg über einen innergemeinschaftlichen Erwerb (§ 1a UStG): Erwerbsteuer (Kz 89/93) und Vorsteuer daraus (Kz 61) */
export interface IgErwerbSource extends InputTaxSource {
  /** Davon als Vorsteuer abziehbar (Kz 61): betrieblicher Teil */
  deductible: Cents;
}

/**
 * Steuerfälle der Ausgangsrechnung, die auch bei Ist-Versteuerung nach Rechnungsdatum gemeldet werden: Reverse Charge
 * (Kz 21) und innergemeinschaftliche Lieferungen (Kz 41) im Voranmeldungszeitraum, in dem die Rechnung ausgestellt ist,
 * spätestens im Folgemonat der Leistung (§ 18b Satz 1 und 2 UStG); Haben nimmt das Rechnungsdatum. Ebenso nicht steuerbare
 * Leistungen ins Drittland (Kz 45): DATEV weist bei Ist-Versteuerung nur steuerpflichtige und steuerfreie inländische
 * Umsätze mit der Zahlung aus, nicht steuerbare Umsätze im Drittland schon mit der Rechnung (DATEV-Dok. 1080673).
 */
export const NACH_RECHNUNGSDATUM = ["reverse_charge", "ig_lieferung", "drittland"] as const satisfies readonly TaxTreatment[];

export interface VatFigures {
  versteuerung: "ist" | "soll";
  /** Kleinunternehmer geben keine Voranmeldung ab */
  kleinunternehmer: boolean;
  /** Bemessungsgrundlagen und Steuer, wie gebucht (noch nicht auf volle Euro abgeschnitten) */
  kz81: Cents;
  tax81: Cents;
  kz86: Cents;
  tax86: Cents;
  /** Reverse Charge im EU-Ausland, nicht steuerbar (Drittland), steuerfrei ohne Vorsteuerabzug */
  kz21: Cents;
  kz45: Cents;
  kz48: Cents;
  kz66: Cents;
  /** § 13b als Leistungsempfänger: EU (46/47), Drittland (84/85), Vorsteuer daraus (67) */
  kz46: Cents;
  kz47: Cents;
  kz84: Cents;
  kz85: Cents;
  kz67: Cents;
  /** Steuerfreie Lieferungen mit Vorsteuerabzug: innergemeinschaftlich (41), Ausfuhr (43) */
  kz41: Cents;
  kz43: Cents;
  /** Innergemeinschaftlicher Erwerb: Bemessungsgrundlagen 19 % (89) und 7 % (93) mit der Erwerbsteuer laut Beleg, Vorsteuer (61) */
  kz89: Cents;
  tax89: Cents;
  kz93: Cents;
  tax93: Cents;
  kz61: Cents;
  /** Entstandene Einfuhrumsatzsteuer laut Bescheid des Zolls (Beleg der Kategorie „Einfuhrumsatzsteuer“), nach Belegdatum */
  kz62: Cents;
  /** Regulär besteuerte Umsätze zu 0 %, die in dieser Voranmeldung nicht gemeldet werden */
  steuerfrei: Cents;
  revenue: RevenueSource[];
  inputTax: InputTaxSource[];
  reverseCharge: ReverseChargeSource[];
  igErwerb: IgErwerbSource[];
  /** Belege zur Einfuhrumsatzsteuer: der ganze Betrag als Steuer */
  einfuhr: InputTaxSource[];
  /**
   * Woher die Kennzahlen kommen: ab dem Stichjahr aus dem Journal (#542, docs/adr/journal-als-quelle.md), davor aus den
   * Nebenbüchern. Die Listen (revenue, inputTax, …) kommen immer aus den Nebenbüchern; sie erläutern die Kennzahlen.
   */
  quelle: "journal" | "nebenbuecher";
  /** Ab dem Stichjahr: die Kennzahlen aus den Nebenbüchern, die Gegenprobe im Abgleich */
  nebenbuecher?: JournalKennzahlen;
}

/**
 * Ab dem Stichjahr (journalAbJahr) sind die Kennzahlen die aus dem Journal; die Privatnutzung von Fahrzeugen kommt dazu wie
 * in den Nebenbüchern aus dem Anlagenverzeichnis. Die Kennzahlen der Nebenbücher bleiben als Gegenprobe für den Abgleich.
 */
async function journalAlsQuelle(period: VatPeriod, figures: VatFigures, q: Db | Tx): Promise<VatFigures> {
  if (period.year < (await journalAbJahr(q))) return figures;
  return ausDemJournal(period, figures, q);
}

async function ausDemJournal(period: VatPeriod, figures: VatFigures, q: Db | Tx): Promise<VatFigures> {
  const journal = await kennzahlenAusDemJournal(period, figures.versteuerung, q);
  const entnahme = figures.revenue.filter((r) => r.type === "entnahme");
  journal.kz81 += entnahme.reduce((s, r) => s + r.base, 0);
  journal.tax81 += entnahme.reduce((s, r) => s + r.tax, 0);
  // Freie Buchungen haben kein Nebenbuch; die Gegenprobe zählt sie aus der festgeschriebenen Buchung selbst
  const manuell = await kennzahlenAusDemJournal(period, figures.versteuerung, q, true);
  const nebenbuecher = Object.fromEntries(JOURNAL_KENNZAHLEN.map((feld) => [feld, figures[feld] + manuell[feld]])) as JournalKennzahlen;
  return { ...figures, ...journal, quelle: "journal", nebenbuecher };
}

/**
 * Kennzahlen eines Monats oder Quartals aus den Buchungen; ein Quartal umfasst die Buchungen seiner drei Monate. Ist-Versteuerung: Umsatzsteuer nach Datum des
 * zugeordneten Zahlungseingangs, bei Teilzahlungen anteilig. Soll: nach Rechnungsdatum.
 * Vorsteuer in beiden Fällen nach Belegdatum.
 */
/** Gemeinsame, auf diesen Leseaufruf begrenzte Caches, etwa für die Quartale einer ZM-Auswahl. */
export function vatFiguresContext(q: Db | Tx = db) {
  const taxes = invoiceTaxReader(q);
  const advances = new Map<number, ReturnType<typeof advanceVatPlans>>();
  return {
    taxes,
    advancePlans(year: number) {
      let plans = advances.get(year);
      if (!plans) {
        plans = advanceVatPlans(q, year, taxes);
        advances.set(year, plans);
      }
      return plans;
    },
  };
}

export async function computeVatFigures(period: VatPeriod, q: Db | Tx = db, context = vatFiguresContext(q)): Promise<VatFigures> {
  const { start, end } = periodRange(period);
  const versteuerung = await context.taxes.modeForYear(period.year);
  const invoiceMode = (invoice: Parameters<typeof context.taxes.companyMode>[0] & { invoiceId?: string }) =>
    context.taxes.companyMode({ ...invoice, id: invoice.id ?? invoice.invoiceId });
  const revenue: RevenueSource[] = [];
  const advances = await context.advancePlans(period.year);
  const advanceIds = new Set(advances.flatMap((p) => [...p.invoiceIds]));
  for (const { original, changes } of advances)
    for (const change of changes) {
      if (change.date < start || change.date >= end) continue;
      for (const share of change.shares)
        revenue.push({
          type: "invoice",
          date: change.date,
          invoiceId: original.id,
          number: original.number ?? "",
          customer: original.buyer?.name ?? "",
          treatment: original.taxTreatment,
          ...share,
        });
    }

  {
    const payments = await q
      .select({
        date: schema.bankTransactions.bookingDate,
        amount: schema.allocations.amount,
        taxShares: schema.allocations.taxShares,
        taxSharesInvoiceId: schema.allocations.taxSharesInvoiceId,
        invoiceId: schema.invoices.id,
        issueDate: schema.invoices.issueDate,
        correctsId: schema.invoices.correctsId,
        advanceType: schema.invoices.advanceType,
        variant: schema.invoices.variant,
        serviceFrom: schema.invoices.serviceFrom,
        serviceTo: schema.invoices.serviceTo,
        number: schema.invoices.number,
        buyer: schema.invoices.buyer,
        treatment: schema.invoices.taxTreatment,
      })
      .from(schema.allocations)
      .innerJoin(schema.bankTransactions, eq(schema.bankTransactions.id, schema.allocations.transactionId))
      .innerJoin(schema.invoices, eq(schema.invoices.id, schema.allocations.invoiceId))
      .where(
        and(
          eq(schema.allocations.kind, "invoice"),
          gte(schema.bankTransactions.bookingDate, start),
          lt(schema.bankTransactions.bookingDate, end),
          // Reverse Charge, innergemeinschaftliche Lieferung und Drittland zählen im Monat der Rechnung, auch bei Ist (siehe oben)
          notInArray(schema.invoices.taxTreatment, [...NACH_RECHNUNGSDATUM]),
        ),
      );
    // Mit der Zahlung als Kursdifferenz ausgebuchter Rest: die Steuer darauf wird mit der Zahlung fällig, in voller Höhe
    // der Rechnung (umgerechnet mit deren Kurs), wie im Journal (exchangeDifferencePosting)
    const differences = await q
      .select({
        date: schema.writeOffs.date,
        amount: schema.writeOffs.amount,
        taxShares: schema.writeOffs.taxShares,
        taxSharesInvoiceId: schema.writeOffs.taxSharesInvoiceId,
        invoiceId: schema.invoices.id,
        issueDate: schema.invoices.issueDate,
        correctsId: schema.invoices.correctsId,
        advanceType: schema.invoices.advanceType,
        variant: schema.invoices.variant,
        serviceFrom: schema.invoices.serviceFrom,
        serviceTo: schema.invoices.serviceTo,
        number: schema.invoices.number,
        buyer: schema.invoices.buyer,
        treatment: schema.invoices.taxTreatment,
      })
      .from(schema.writeOffs)
      .innerJoin(schema.invoices, eq(schema.invoices.id, schema.writeOffs.invoiceId))
      .where(
        and(
          eq(schema.writeOffs.kind, "kursdifferenz"),
          gte(schema.writeOffs.date, start),
          lt(schema.writeOffs.date, end),
          notInArray(schema.invoices.taxTreatment, [...NACH_RECHNUNGSDATUM]),
        ),
      );
    // Bareinnahmen auf Rechnungen im Kassenbuch (samt Storno): wie eine Zahlung über die Bank, am Tag der Bareinnahme
    const cash = await q
      .select({
        date: schema.cashEntries.date,
        amount: schema.cashEntries.amount,
        taxShares: schema.cashEntries.taxShares,
        taxSharesInvoiceId: schema.cashEntries.taxSharesInvoiceId,
        invoiceId: schema.invoices.id,
        issueDate: schema.invoices.issueDate,
        correctsId: schema.invoices.correctsId,
        advanceType: schema.invoices.advanceType,
        variant: schema.invoices.variant,
        serviceFrom: schema.invoices.serviceFrom,
        serviceTo: schema.invoices.serviceTo,
        number: schema.invoices.number,
        buyer: schema.invoices.buyer,
        treatment: schema.invoices.taxTreatment,
      })
      .from(schema.cashEntries)
      .innerJoin(schema.invoices, eq(schema.invoices.id, schema.cashEntries.invoiceId))
      .where(and(gte(schema.cashEntries.date, start), lt(schema.cashEntries.date, end), notInArray(schema.invoices.taxTreatment, [...NACH_RECHNUNGSDATUM])));
    payments.push(...differences, ...cash);
    const totals = await invoiceTotalsById([...new Set(payments.map((p) => p.invoiceId))], q);
    for (const p of payments) {
      if (advanceIds.has(p.invoiceId)) continue;
      if ((await invoiceMode(p)) !== "ist") continue;
      // Wie gebucht (bank.ts, settlementTaxShares); ältere Zahlungen ohne gespeicherten Anteil aus dem Betrag
      const stored = p.taxSharesInvoiceId === p.invoiceId ? p.taxShares : null;
      for (const share of recordedTaxShares(totals.get(p.invoiceId)!, p.amount, stored)) {
        revenue.push({
          type: "payment",
          date: p.date,
          invoiceId: p.invoiceId,
          number: p.number ?? "",
          customer: p.buyer?.name ?? "",
          treatment: p.treatment,
          rate: share.rate,
          base: share.base,
          tax: share.tax,
        });
      }
    }
  }

  // Soll: alle Rechnungen nach Rechnungsdatum. Ist: nur Reverse Charge, innergemeinschaftliche Lieferungen und Leistungen
  // ins Drittland, die Meldung in Kz 21, 41 und 45 richtet sich nach der Rechnung, nicht nach der Zahlung (NACH_RECHNUNGSDATUM).
  {
    const issued = await q
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.status, "final"),
          or(
            and(gte(schema.invoices.issueDate, start), lt(schema.invoices.issueDate, end)),
            and(gte(schema.invoices.serviceFrom, start), lt(schema.invoices.serviceFrom, end)),
            and(gte(schema.invoices.serviceTo, start), lt(schema.invoices.serviceTo, end)),
          ),
          // aus Lexoffice übernommen: die Steuer ist dort schon angemeldet
          isNull(schema.invoices.lexofficeVoucherId),
        ),
      );
    const totals = await invoiceTotalsById(
      issued.map((i) => i.id),
      q,
    );
    for (const inv of issued) {
      if (advanceIds.has(inv.id)) continue;
      const date = await context.taxes.date(inv);
      if (date < start || date >= end) continue;
      if ((await invoiceMode(inv)) === "ist" && !NACH_RECHNUNGSDATUM.some((t) => t === inv.taxTreatment)) continue;
      for (const t of totals.get(inv.id)?.taxes ?? []) {
        revenue.push({
          type: "invoice",
          date,
          invoiceId: inv.id,
          number: inv.number ?? "",
          customer: inv.buyer?.name ?? "",
          treatment: inv.taxTreatment,
          rate: t.rate,
          base: t.base,
          tax: t.tax,
        });
      }
    }
  }

  // Ausbuchungen (§ 17 UStG): Skonto und Forderungsausfall mindern die Bemessungsgrundlage im Monat der Ausbuchung.
  // Bei Ist zählt ohnehin nur, was bezahlt wird; ausgenommen, was auch bei Ist nach Rechnung zählt (NACH_RECHNUNGSDATUM).
  {
    const rows = await q
      .select({
        date: schema.writeOffs.date,
        amount: schema.writeOffs.amount,
        taxShares: schema.writeOffs.taxShares,
        taxSharesInvoiceId: schema.writeOffs.taxSharesInvoiceId,
        invoiceId: schema.invoices.id,
        issueDate: schema.invoices.issueDate,
        correctsId: schema.invoices.correctsId,
        advanceType: schema.invoices.advanceType,
        variant: schema.invoices.variant,
        serviceFrom: schema.invoices.serviceFrom,
        serviceTo: schema.invoices.serviceTo,
        number: schema.invoices.number,
        buyer: schema.invoices.buyer,
        treatment: schema.invoices.taxTreatment,
      })
      .from(schema.writeOffs)
      .innerJoin(schema.invoices, eq(schema.invoices.id, schema.writeOffs.invoiceId))
      .where(
        and(
          gte(schema.writeOffs.date, start),
          lt(schema.writeOffs.date, end),
          // Kursdifferenzen ändern die Bemessungsgrundlage nicht, sie bleibt beim Kurs der Rechnung
          ne(schema.writeOffs.kind, "kursdifferenz"),
        ),
      );
    const totals = await invoiceTotalsById([...new Set(rows.map((r) => r.invoiceId))], q);
    for (const r of rows) {
      if (advanceIds.has(r.invoiceId)) continue;
      if ((await invoiceMode(r)) === "ist" && !NACH_RECHNUNGSDATUM.some((t) => t === r.treatment)) continue;
      const stored = r.taxSharesInvoiceId === r.invoiceId ? r.taxShares?.map((t) => ({ rate: t.rate, base: -t.base, tax: -t.tax })) : null;
      const shares = recordedTaxShares(totals.get(r.invoiceId)!, -r.amount, stored);
      for (const share of shares) {
        revenue.push({
          type: "ausbuchung",
          date: r.date,
          invoiceId: r.invoiceId,
          number: r.number ?? "",
          customer: r.buyer?.name ?? "",
          treatment: r.treatment,
          rate: share.rate,
          base: share.base,
          tax: share.tax,
        });
      }
    }
  }

  // Direkt auf eine Einnahmekategorie gebuchte Bankumsätze (#324): ohne Rechnung am Tag der Zahlung, bei Ist wie bei Soll
  // (packages/core/src/direkt-kategorie.ts); die Gegenzeile einer aufgehobenen Zuordnung mit umgekehrtem Vorzeichen
  {
    const rows = await q
      .select({
        date: schema.bankTransactions.bookingDate,
        transactionId: schema.allocations.transactionId,
        amount: schema.allocations.amount,
        category: schema.allocations.category,
        taxRate: schema.allocations.taxRate,
        counterparty: schema.bankTransactions.counterpartyName,
      })
      .from(schema.allocations)
      .innerJoin(schema.bankTransactions, eq(schema.bankTransactions.id, schema.allocations.transactionId))
      .where(and(eq(schema.allocations.kind, "kategorie"), gte(schema.bankTransactions.bookingDate, start), lt(schema.bankTransactions.bookingDate, end)));
    for (const r of rows) {
      if (!r.category || r.taxRate === null || kategorieArt(r.category) !== "einnahme") continue;
      const { base, tax } = kategorieAnteil({ kategorie: r.category, steuersatz: r.taxRate }, r.amount);
      revenue.push({
        type: "direkt",
        date: r.date,
        invoiceId: "",
        transactionId: r.transactionId,
        number: "Direkt gebucht",
        customer: r.counterparty,
        treatment: r.taxRate === 0 ? "kleinunternehmer" : "regulaer",
        rate: r.taxRate,
        base,
        tax,
      });
    }
  }

  // Bareinnahmen ohne Rechnung im Kassenbuch (#276): am Tag der Bareinnahme, bei Ist wie bei Soll
  // (packages/core/src/bareinnahme.ts); der Storno mit umgekehrtem Vorzeichen an seinem Tag
  {
    const rows = await q
      .select({
        id: schema.cashEntries.id,
        date: schema.cashEntries.date,
        amount: schema.cashEntries.amount,
        text: schema.cashEntries.text,
        treatment: schema.cashEntries.taxTreatment,
        rate: schema.cashEntries.taxRate,
      })
      .from(schema.cashEntries)
      .where(and(eq(schema.cashEntries.kind, "einnahme"), gte(schema.cashEntries.date, start), lt(schema.cashEntries.date, end)));
    for (const r of rows) {
      if (!r.treatment || r.rate === null) continue;
      const { base, tax } = bareinnahmeAnteil({ behandlung: r.treatment, steuersatz: r.rate }, r.amount);
      revenue.push({
        type: "kasse",
        date: r.date,
        invoiceId: "",
        cashEntryId: r.id,
        number: "Bareinnahme",
        customer: r.text,
        treatment: r.treatment,
        rate: r.rate,
        base,
        tax,
      });
    }
  }

  // Private Kfz-Nutzung: unentgeltliche Wertabgabe im Monat der Nutzung, auch bei Ist-Versteuerung
  for (const { year, month } of monthsOfPeriod(period)) {
    const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    for (const use of await privateUseForMonth(year, month, q)) {
      revenue.push({
        type: "entnahme",
        date: lastDay,
        invoiceId: "",
        assetId: use.assetId,
        number: "Privatnutzung",
        customer: use.name,
        treatment: "regulaer",
        rate: 1900,
        base: use.base,
        tax: use.tax,
      });
    }
  }

  // Belege nach Belegdatum; ein Storno (#237) zählt mit umgekehrtem Vorzeichen im Monat des Stornos (§ 17 Abs. 1 UStG)
  const documentColumns = {
    documentId: schema.documents.id,
    supplier: schema.documents.supplierName,
    number: schema.documents.invoiceNumber,
    rate: schema.documentAmounts.taxRate,
    base: schema.documentAmounts.net,
    tax: schema.documentAmounts.tax,
    gross: schema.documents.gross,
    payment: schema.documents.payment,
    privateShare: schema.documents.privateShare,
    vorsteuerAbzug: schema.documents.vorsteuerAbzug,
    reverseCharge: schema.documents.reverseCharge,
    category: schema.documents.category,
  };
  const booked = await q
    .select({ ...documentColumns, date: schema.documents.documentDate })
    .from(schema.documentAmounts)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentAmounts.documentId))
    .where(
      and(
        eq(schema.documents.status, "gebucht"),
        gte(schema.documents.documentDate, start),
        lt(schema.documents.documentDate, end),
        isNull(schema.documents.lexofficeVoucherId),
      ),
    );
  const cancelled = await q
    .select({ ...documentColumns, date: schema.documentCancellations.date })
    .from(schema.documentAmounts)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentAmounts.documentId))
    .innerJoin(schema.documentCancellations, eq(schema.documentCancellations.documentId, schema.documents.id))
    .where(and(gte(schema.documentCancellations.date, start), lt(schema.documentCancellations.date, end)));
  const amounts = [
    ...booked.map((a) => ({ ...a, date: a.date!, sign: 1 })),
    ...cancelled.map((a) => ({ ...a, number: `Storno ${a.number}`.trim(), sign: -1 })),
  ];
  // Mit Privatanteil zählt nur der betriebliche Teil (beim Storno derselbe wie beim Buchen); Kleinunternehmer ziehen keine Vorsteuer ab
  const business = (amount: Cents, privateShare: number, sign: number) => sign * splitPrivateShare(amount, privateShare).business;
  // Gutschriften (negativer Beleg) mindern die Vorsteuer erst mit der Erstattung oder Verrechnung (#690, gutschrift.ts);
  // bar oder privat bezahlte sind mit der Buchung ausgeglichen und zählen wie jeder andere Beleg im Belegmonat
  const inputTax = amounts
    .filter((a) => a.vorsteuerAbzug && !a.reverseCharge && (a.gross >= 0 || a.payment !== "bank"))
    .map(({ privateShare, vorsteuerAbzug: _abzug, reverseCharge: _rc, gross: _gross, payment: _payment, sign, category: _category, ...a }) => ({
      ...a,
      base: business(a.base, privateShare, sign),
      tax: business(a.tax, privateShare, sign),
    }))
    .filter((a) => a.tax !== 0);
  // Erhaltenes Skonto mindert die Vorsteuer im Monat der Ausbuchung (§ 17 Abs. 1 Satz 2 UStG), anteilig je Steuersatz
  const discounts = await q
    .select({
      documentId: schema.documents.id,
      date: schema.writeOffs.date,
      amount: schema.writeOffs.amount,
      supplier: schema.documents.supplierName,
      number: schema.documents.invoiceNumber,
      net: schema.documents.net,
      tax: schema.documents.tax,
      gross: schema.documents.gross,
    })
    .from(schema.writeOffs)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.writeOffs.documentId))
    .where(
      and(
        gte(schema.writeOffs.date, start),
        lt(schema.writeOffs.date, end),
        eq(schema.writeOffs.kind, "skontoErhalten"),
        gte(schema.documents.gross, 0),
        eq(schema.documents.vorsteuerAbzug, true),
      ),
    );
  if (discounts.length > 0) {
    const docAmounts = await q
      .select()
      .from(schema.documentAmounts)
      .where(inArray(schema.documentAmounts.documentId, [...new Set(discounts.map((d) => d.documentId))]));
    for (const d of discounts) {
      const taxes = docAmounts
        .filter((a) => a.documentId === d.documentId)
        .map((a) => ({ rate: a.taxRate, base: a.net, tax: a.tax }))
        .sort((a, b) => b.rate - a.rate);
      for (const share of paidTaxShares({ net: d.net, tax: d.tax, gross: d.gross, taxes }, -d.amount)) {
        if (share.tax === 0) continue;
        inputTax.push({ documentId: d.documentId, date: d.date, supplier: d.supplier, number: d.number, rate: share.rate, base: -share.base, tax: -share.tax });
      }
    }
  }
  // Erstattung oder Verrechnung einer Gutschrift: die Vorsteuer mindert sich im Monat des Vorgangs (§ 17 UStG), je
  // Zahlung, Verrechnung und Ausbuchung ein Eintrag mit deren Datum (gutschrift.ts)
  inputTax.push(...(await gutschriftAnteile(period, q)));
  // § 13b: Bemessungsgrundlage und Steuer voll, auch bei Privatanteil; Vorsteuer nur betrieblich
  const reverseCharge: ReverseChargeSource[] = amounts
    .filter((a): a is typeof a & { reverseCharge: "eu" | "drittland" } => a.reverseCharge === "eu" || a.reverseCharge === "drittland")
    .map(({ privateShare, vorsteuerAbzug, reverseCharge: rc, gross: _gross, payment: _payment, sign, ...a }) => ({
      ...a,
      base: sign * a.base,
      tax: sign * a.tax,
      reverseCharge: rc,
      deductible: vorsteuerAbzug ? business(a.tax, privateShare, sign) : 0,
    }));
  // Innergemeinschaftlicher Erwerb ebenso, nach Belegdatum auch bei Ist-Versteuerung: Die Steuer entsteht mit Ausstellung
  // der Rechnung, spätestens mit Ablauf des Folgemonats (§ 13 Abs. 1 Nr. 6 UStG), nicht mit der Zahlung
  const igErwerb: IgErwerbSource[] = amounts
    .filter((a) => a.reverseCharge === "ig_erwerb")
    .map(({ privateShare, vorsteuerAbzug, reverseCharge: _rc, gross: _gross, payment: _payment, sign, ...a }) => ({
      ...a,
      base: sign * a.base,
      tax: sign * a.tax,
      deductible: vorsteuerAbzug ? business(a.tax, privateShare, sign) : 0,
    }));
  // Einfuhrumsatzsteuer (§ 15 Abs. 1 Satz 1 Nr. 2 UStG): der Betrag des Bescheids ist die Steuer, abziehbar nach Belegdatum
  const einfuhr: InputTaxSource[] = amounts
    .filter((a) => a.category === "einfuhrumsatzsteuer" && a.vorsteuerAbzug && !a.reverseCharge)
    .map(({ privateShare: _p, vorsteuerAbzug: _v, reverseCharge: _rc, category: _c, gross: _gross, payment: _payment, sign, ...a }) => ({
      ...a,
      base: 0,
      tax: sign * (a.base + a.tax),
    }));
  const ige = (rate: number, key: "base" | "tax") => igErwerb.filter((r) => r.rate === rate).reduce((s, r) => s + r[key], 0);
  const rcSum = (kind: "eu" | "drittland", key: "base" | "tax") => reverseCharge.filter((r) => r.reverseCharge === kind).reduce((s, r) => s + r[key], 0);

  const regular = revenue.filter((r) => r.treatment === "regulaer");
  const sum = (rows: { base: Cents; tax: Cents; rate: number }[], rate: number, key: "base" | "tax") =>
    rows.filter((r) => r.rate === rate).reduce((s, r) => s + r[key], 0);
  const treated = (treatment: TaxTreatment) => revenue.filter((r) => r.treatment === treatment).reduce((s, r) => s + r.base, 0);

  const figures: VatFigures = {
    versteuerung,
    // Stand am Ende des Zeitraums der Voranmeldung, nicht der heutige
    kleinunternehmer: await kleinunternehmerForMonth(lastMonthOfPeriod(period).year, lastMonthOfPeriod(period).month, q),
    kz81: sum(regular, 1900, "base"),
    tax81: sum(regular, 1900, "tax"),
    kz86: sum(regular, 700, "base"),
    tax86: sum(regular, 700, "tax"),
    kz21: treated("reverse_charge"),
    kz45: treated("drittland"),
    kz48: treated("steuerfrei"),
    kz66: inputTax.reduce((s, a) => s + a.tax, 0),
    kz46: rcSum("eu", "base"),
    kz47: rcSum("eu", "tax"),
    kz84: rcSum("drittland", "base"),
    kz85: rcSum("drittland", "tax"),
    kz67: reverseCharge.reduce((s, r) => s + r.deductible, 0),
    kz41: treated("ig_lieferung"),
    kz43: treated("ausfuhr"),
    kz89: ige(1900, "base"),
    tax89: ige(1900, "tax"),
    kz93: ige(700, "base"),
    tax93: ige(700, "tax"),
    kz61: igErwerb.reduce((s, r) => s + r.deductible, 0),
    kz62: einfuhr.reduce((s, r) => s + r.tax, 0),
    steuerfrei: sum(regular, 0, "base"),
    revenue,
    inputTax,
    reverseCharge,
    igErwerb,
    einfuhr,
    quelle: "nebenbuecher",
  };
  return journalAlsQuelle(period, figures, q);
}

export interface PreflightIssue {
  tone: "warn" | "info";
  text: string;
  link: "/bank" | "/belege" | "/rechnungen" | "/konten";
}

/** Vorprüfung vor dem Senden: was im Zeitraum noch offen ist und die Zahlen verfälschen könnte */
export async function preflight(period: VatPeriod, figures: VatFigures): Promise<PreflightIssue[]> {
  const { start, end } = periodRange(period);
  const issues: PreflightIssue[] = [];
  // Verrechnete Umsätze (#457) sind erledigt wie zugeordnete
  const open = bankOpenAmountSql;

  const [bank] = await db
    .select({
      incoming: sql<number>`count(*) filter (where ${schema.bankTransactions.amount} > 0)::int`,
      outgoing: sql<number>`count(*) filter (where ${schema.bankTransactions.amount} < 0)::int`,
    })
    .from(schema.bankTransactions)
    .where(
      and(
        gte(schema.bankTransactions.bookingDate, start),
        lt(schema.bankTransactions.bookingDate, end),
        sql`${open} <> 0`,
        bankAccountIncludedSql("bank_account_id"),
      ),
    );
  if (bank && bank.outgoing > 0) {
    issues.push({
      tone: "warn",
      text: `${bank.outgoing} ${bank.outgoing === 1 ? "Ausgabe" : "Ausgaben"} im Zeitraum ohne Beleg oder Zuordnung. Ohne Beleg wird keine Vorsteuer angesetzt.`,
      link: "/bank",
    });
  }
  if (bank && bank.incoming > 0) {
    issues.push({
      tone: figures.versteuerung === "ist" ? "warn" : "info",
      text: `${bank.incoming} ${bank.incoming === 1 ? "Zahlungseingang" : "Zahlungseingänge"} im Zeitraum noch nicht zugeordnet${figures.versteuerung === "ist" ? "; bei Ist-Versteuerung fehlt sonst Umsatzsteuer" : ""}.`,
      link: "/bank",
    });
  }

  const [docs] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.status, "neu"),
        or(and(gte(schema.documents.documentDate, start), lt(schema.documents.documentDate, end)), isNull(schema.documents.documentDate)),
      ),
    );
  if (docs && docs.n > 0) {
    issues.push({ tone: "warn", text: `${docs.n} ${docs.n === 1 ? "Beleg ist" : "Belege sind"} noch nicht gebucht.`, link: "/belege" });
  }

  const [drafts] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.status, "draft"), gte(schema.invoices.issueDate, start), lt(schema.invoices.issueDate, end)));
  if (drafts && drafts.n > 0) {
    issues.push({ tone: "info", text: `${drafts.n} ${drafts.n === 1 ? "Rechnungsentwurf" : "Rechnungsentwürfe"} mit Datum im Zeitraum.`, link: "/rechnungen" });
  }

  if (figures.steuerfrei !== 0) {
    issues.push({
      tone: "warn",
      text: "Im Zeitraum gibt es regulär besteuerte Umsätze zu 0 %. Haben meldet sie nicht; ist es Reverse Charge, Drittland oder steuerfrei, stelle das an der Rechnung ein.",
      link: "/rechnungen",
    });
  }
  return issues;
}

/**
 * Kennzahlen eines Zeitraums aus dem Journal und aus den Nebenbüchern, unabhängig vom Stichjahr. Für das Vorziehen des
 * Stichjahrs (auswertungen/stichjahr.ts): Es ändert keine Zahl, wenn beide gleich sind. Der Abgleich allein reicht dafür
 * nicht, er lässt ältere Buchungen ohne Bemessungsgrundlage bzw. Steuerschlüssel bewusst aus.
 */
export async function kennzahlenBeiderQuellen(period: VatPeriod, q: Db | Tx = db): Promise<{ journal: JournalKennzahlen; nebenbuecher: JournalKennzahlen }> {
  const figures = await computeVatFigures(period, q);
  const beide = figures.quelle === "journal" ? figures : await ausDemJournal(period, figures, q);
  const journal = Object.fromEntries(JOURNAL_KENNZAHLEN.map((feld) => [feld, beide[feld]])) as JournalKennzahlen;
  return { journal, nebenbuecher: beide.nebenbuecher! };
}
