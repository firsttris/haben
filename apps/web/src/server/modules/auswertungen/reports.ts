import {
  isKapitalgesellschaft,
  bareinnahmeTotals,
  computeEuer,
  EXPENSE_CATEGORIES,
  type EuerPayment,
  type EuerResult,
  type ExpenseCategory,
  type InvoiceTotals,
  isLohnZahlung,
  LOHN_ZAHLUNGEN,
  recordedTaxShares,
  totalsFromTaxes,
  documentOpen,
  periodKey,
  vatPostenLabel,
} from "@haben/core";
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { depreciationForEuer, withdrawalsForEuer } from "../buchhaltung/index.ts";
import { journalAbJahr, loadCompany } from "../stammdaten/index.ts";
import { euerVerschiebung } from "./euer-jahreswechsel.ts";
import { euerAusDemJournal, mitFreienBuchungen } from "./euer-quelle.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { documentNotCancelled } from "../../db/document-cancelled.ts";
import { splitsByDocument } from "../belege/index.ts";
import { invoiceTotalsById } from "../rechnungen/index.ts";
import { listInvoices } from "../rechnungen/index.ts";
import { today as todayInGermany } from "../../today.ts";
import { ustvaPosten } from "../umsatzsteuer/index.ts";

const isCategory = (value: string | null): value is ExpenseCategory => value !== null && value in EXPENSE_CATEGORIES;

/** Summen aus den Beträgen eines Belegs je Steuersatz */
function documentTotals(amounts: { taxRate: number; net: number; tax: number }[]): InvoiceTotals {
  return totalsFromTaxes(amounts.map((a) => ({ rate: a.taxRate, base: a.net, tax: a.tax })));
}

/** Summen je Beleg; reverseCharge sind die Belege mit selbst geschuldeter Steuer (§ 13b, innergemeinschaftlicher Erwerb) */
async function documentTotalsById(
  ids: string[],
  q: Db | Tx = db,
): Promise<{ totals: Map<string, InvoiceTotals>; reverseCharge: Set<string>; selbstGeschuldet: Map<string, number[]> }> {
  if (ids.length === 0) return { totals: new Map(), reverseCharge: new Set(), selbstGeschuldet: new Map() };
  const amounts = await q.select().from(schema.documentAmounts).where(inArray(schema.documentAmounts.documentId, ids));
  const reverseCharge = new Set(
    (
      await q
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(and(inArray(schema.documents.id, ids), isNotNull(schema.documents.reverseCharge)))
    ).map((d) => d.id),
  );
  // § 13b: Gezahlt ist nur netto. Die selbst geschuldete Steuer und die Vorsteuer daraus heben sich auf;
  // ohne Vorsteuerabzug zählt die Steuer, wenn sie mit der Voranmeldung ans Finanzamt geht.
  const totals = new Map(
    ids.map((id) => {
      const rows = amounts.filter((a) => a.documentId === id);
      return [id, documentTotals(reverseCharge.has(id) ? rows.map((a) => ({ ...a, tax: 0 })) : rows)];
    }),
  );
  return {
    totals,
    reverseCharge,
    selbstGeschuldet: new Map([...reverseCharge].map((id) => [id, amounts.filter((a) => a.documentId === id).map((a) => a.tax)])),
  };
}

/**
 * Alle Zahlungen eines Jahres für die EÜR: Zuordnungen im Bankabgleich nach Buchungsdatum
 * des Umsatzes, privat bezahlte Belege nach Belegdatum. Privat und Geldtransit sind nicht
 * betrieblich und fehlen deshalb.
 */
export async function euerPayments(year: number, q: Db | Tx = db): Promise<EuerPayment[]> {
  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;
  // Vorauszahlung für Dezember bzw. das vierte Quartal vom 1. bis 10. Januar: zählt im Vorjahr (euer-jahreswechsel.ts)
  const { herein, hinaus } = await euerVerschiebung(year, q);
  const imJahr = and(gte(schema.bankTransactions.bookingDate, start), lt(schema.bankTransactions.bookingDate, end));
  const allocations = await q
    .select({
      id: schema.allocations.id,
      reversesId: schema.allocations.reversesId,
      kind: schema.allocations.kind,
      amount: schema.allocations.amount,
      taxShares: schema.allocations.taxShares,
      taxSharesInvoiceId: schema.allocations.taxSharesInvoiceId,
      invoiceId: schema.allocations.invoiceId,
      documentId: schema.allocations.documentId,
      transactionId: schema.allocations.transactionId,
      date: schema.bankTransactions.bookingDate,
      category: schema.documents.category,
      vorsteuerAbzug: schema.documents.vorsteuerAbzug,
      privateShare: schema.documents.privateShare,
      treatment: schema.invoices.taxTreatment,
      taxType: schema.allocations.taxType,
      taxItem: schema.allocations.taxItem,
      loanPart: schema.allocations.loanPart,
      loanPurpose: schema.loans.purpose,
      directCategory: schema.allocations.category,
      directTaxRate: schema.allocations.taxRate,
    })
    .from(schema.allocations)
    .innerJoin(schema.bankTransactions, eq(schema.bankTransactions.id, schema.allocations.transactionId))
    .leftJoin(schema.documents, eq(schema.documents.id, schema.allocations.documentId))
    .leftJoin(schema.invoices, eq(schema.invoices.id, schema.allocations.invoiceId))
    .leftJoin(schema.loans, eq(schema.loans.id, schema.allocations.loanId))
    .where(
      and(
        herein.size > 0 ? or(imJahr, inArray(schema.allocations.id, [...herein])) : imJahr,
        inArray(schema.allocations.kind, [
          "invoice",
          "document",
          "ustVorauszahlung",
          "sondervorauszahlung",
          "gebuehren",
          "mahnerloes",
          "kursdifferenz",
          "zinsertrag",
          "steuer",
          "darlehen",
          "kategorie",
          ...LOHN_ZAHLUNGEN,
        ]),
      ),
    );

  const privateDocs = await q
    .select({
      id: schema.documents.id,
      date: schema.documents.documentDate,
      gross: schema.documents.gross,
      category: schema.documents.category,
      vorsteuerAbzug: schema.documents.vorsteuerAbzug,
      privateShare: schema.documents.privateShare,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.status, "gebucht"),
        // Privat oder bar aus der Kasse bezahlt: Abfluss am Belegdatum
        inArray(schema.documents.payment, ["privat", "kasse"]),
        isNotNull(schema.documents.documentDate),
        gte(schema.documents.documentDate, start),
        lt(schema.documents.documentDate, end),
      ),
    );

  // Storno eines privat oder bar bezahlten Belegs (#237): fließt am Datum der Gegenbuchung zurück. Über die Bank bezahlte Belege
  // lassen sich nur ohne Zahlung stornieren, sie haben in der EÜR nichts zurückzunehmen.
  const cancelledDocs = await q
    .select({
      id: schema.documents.id,
      date: schema.documentCancellations.date,
      gross: schema.documents.gross,
      category: schema.documents.category,
      vorsteuerAbzug: schema.documents.vorsteuerAbzug,
      privateShare: schema.documents.privateShare,
    })
    .from(schema.documentCancellations)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentCancellations.documentId))
    .where(
      and(inArray(schema.documents.payment, ["privat", "kasse"]), gte(schema.documentCancellations.date, start), lt(schema.documentCancellations.date, end)),
    );

  // Kursdifferenz beim Ausgleich einer Fremdwährungsrechnung: in der EÜR zählt der gezahlte Euro-Betrag. Der ausgebuchte
  // Rest wird als Teil der Rechnung bzw. des Belegs gezählt und als eigener Posten Kursgewinn bzw. -verlust wieder abgezogen.
  const exchangeDifferences = await q
    .select({
      amount: schema.writeOffs.amount,
      taxShares: schema.writeOffs.taxShares,
      taxSharesInvoiceId: schema.writeOffs.taxSharesInvoiceId,
      date: schema.writeOffs.date,
      invoiceId: schema.writeOffs.invoiceId,
      documentId: schema.writeOffs.documentId,
      transactionId: schema.writeOffs.transactionId,
      category: schema.documents.category,
      vorsteuerAbzug: schema.documents.vorsteuerAbzug,
      privateShare: schema.documents.privateShare,
      treatment: schema.invoices.taxTreatment,
    })
    .from(schema.writeOffs)
    .leftJoin(schema.documents, eq(schema.documents.id, schema.writeOffs.documentId))
    .leftJoin(schema.invoices, eq(schema.invoices.id, schema.writeOffs.invoiceId))
    .where(and(eq(schema.writeOffs.kind, "kursdifferenz"), gte(schema.writeOffs.date, start), lt(schema.writeOffs.date, end)));

  // Bareinnahmen auf Rechnungen im Kassenbuch: Zufluss am Tag der Bareinnahme (§ 11 Abs. 1 EStG), Storno am Tag des Stornos
  const cashReceipts = await q
    .select({
      amount: schema.cashEntries.amount,
      taxShares: schema.cashEntries.taxShares,
      taxSharesInvoiceId: schema.cashEntries.taxSharesInvoiceId,
      invoiceId: schema.cashEntries.invoiceId,
      date: schema.cashEntries.date,
      treatment: schema.invoices.taxTreatment,
    })
    .from(schema.cashEntries)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.cashEntries.invoiceId))
    .where(and(gte(schema.cashEntries.date, start), lt(schema.cashEntries.date, end)));

  // Bareinnahmen ohne Rechnung (#276): Zufluss am Tag der Bareinnahme, Storno am Tag des Stornos
  const cashIncome = await q
    .select({
      id: schema.cashEntries.id,
      reversesId: schema.cashEntries.reversesId,
      amount: schema.cashEntries.amount,
      date: schema.cashEntries.date,
      treatment: schema.cashEntries.taxTreatment,
      rate: schema.cashEntries.taxRate,
    })
    .from(schema.cashEntries)
    .where(and(eq(schema.cashEntries.kind, "einnahme"), gte(schema.cashEntries.date, start), lt(schema.cashEntries.date, end)));

  const invoiceTotals = await invoiceTotalsById(
    [...new Set([...allocations, ...exchangeDifferences, ...cashReceipts].flatMap((a) => (a.invoiceId ? [a.invoiceId] : [])))],
    q,
  );
  const {
    totals: docTotals,
    reverseCharge,
    selbstGeschuldet,
  } = await documentTotalsById(
    [
      ...new Set([
        ...[...allocations, ...exchangeDifferences].flatMap((a) => (a.documentId ? [a.documentId] : [])),
        ...privateDocs.map((d) => d.id),
        ...cancelledDocs.map((d) => d.id),
      ]),
    ],
    q,
  );
  // Aufgeteilte Belege (#271): Ausgaben je Kontierungszeile statt je Kategorie des Belegs; § 13b: die selbst geschuldete Steuer
  const docSplits = await splitsByDocument([...docTotals.keys()], q);
  const belegAngaben = (documentId: string) => {
    const splits = docSplits.get(documentId);
    const steuer = selbstGeschuldet.get(documentId);
    const rc = steuer ? { selbstGeschuldet: steuer } : {};
    if (!splits) return rc;
    // § 13b (#508): Die Zeilen tragen ihren Anteil der selbst geschuldeten Steuer; gezahlt ist wie in docTotals nur netto
    return { ...rc, splits: reverseCharge.has(documentId) ? splits.map((line) => ({ ...line, tax: 0 })) : splits };
  };

  const payments: EuerPayment[] = [];
  for (const zuordnung of allocations) {
    if (hinaus.has(zuordnung.id)) continue;
    const a = herein.has(zuordnung.id) ? { ...zuordnung, date: `${year}-12-31` } : zuordnung;
    // Zuordnung und Gegenzeile hängen am selben Umsatz und heben sich so exakt auf
    const group = `${a.transactionId}|${a.invoiceId ?? a.documentId ?? a.kind}`;
    if (a.kind === "invoice" && a.invoiceId) {
      payments.push({
        kind: "invoice",
        date: a.date,
        paid: a.amount,
        totals: invoiceTotals.get(a.invoiceId)!,
        // Wie gebucht; ältere Zahlungen ohne gespeicherten Anteil rechnet die EÜR weiter aus der Summe je Umsatz
        ...(a.taxShares
          ? { shares: recordedTaxShares(invoiceTotals.get(a.invoiceId)!, a.amount, a.taxSharesInvoiceId === a.invoiceId ? a.taxShares : null) }
          : {}),
        treatment: a.treatment ?? "regulaer",
        group,
      });
    } else if (a.kind === "document" && a.documentId) {
      payments.push({
        kind: "document",
        date: a.date,
        paid: -a.amount,
        totals: docTotals.get(a.documentId)!,
        category: isCategory(a.category) ? a.category : "sonstiges",
        vorsteuerAbzug: a.vorsteuerAbzug ?? true,
        privateShare: a.privateShare ?? 0,
        ...belegAngaben(a.documentId),
        group,
      });
    } else if (
      a.kind === "ustVorauszahlung" ||
      a.kind === "sondervorauszahlung" ||
      a.kind === "gebuehren" ||
      a.kind === "mahnerloes" ||
      a.kind === "zinsertrag" ||
      a.kind === "kursdifferenz"
    ) {
      payments.push({
        kind: a.kind,
        date: a.date,
        amount: a.amount,
        // Verrechnete Zahlung und Erstattung desselben Umsatzes bleiben eigene EÜR-Zeilen (Anleitung EÜR 2025, Z. 18/58).
        // Nur eine Zuordnung und ihre Gegenzeile verrechnen; ustAbfluss gehört jeweils zu dieser ursprünglichen Zuordnung.
        group: a.kind === "ustVorauszahlung" || a.kind === "sondervorauszahlung" ? (a.reversesId ?? a.id) : group,
        // Die Richtung bleibt die der ursprünglichen Zuordnung, auch nach einer jahresübergreifenden Rücknahme.
        ...(a.kind === "ustVorauszahlung" || a.kind === "sondervorauszahlung" ? { ustAbfluss: (a.reversesId ? -a.amount : a.amount) < 0 } : {}),
      });
    } else if (a.kind === "steuer" && a.taxType && a.taxItem) {
      // Im Jahr der Zahlung (§ 11 EStG), unabhängig vom Bezugsjahr; Teil und Steuerart bestimmen die Zeile
      // Je Zuordnung, nicht je Umsatz: Die Wirkung hängt am Vorzeichen jedes Teils (Erstattungszinsen sind Einnahme,
      // Nachzahlungszinsen zur Gewerbesteuer nicht); nur Zuordnung und Gegenzeile heben sich auf
      payments.push({ kind: "steuer", date: a.date, amount: a.amount, art: a.taxType, posten: a.taxItem, group: a.reversesId ?? a.id });
    } else if (a.kind === "darlehen" && a.loanPart && a.loanPurpose) {
      // Zinsen und Gebühren als Schuldzinsen, wenn sie abfließen; Auszahlung und Tilgung sind erfolgsneutral
      payments.push({ kind: "darlehen", date: a.date, amount: a.amount, zweck: a.loanPurpose, teil: a.loanPart, group });
    } else if (a.kind === "kategorie" && a.directCategory && a.directTaxRate !== null) {
      // Direkt auf eine Kategorie (#324): Einnahme netto und Umsatzsteuer, Ausgabe brutto, am Tag der Zahlung. Je Teil mit
      // seiner Gegenzeile verrechnet, nicht je Umsatz: Journal und Voranmeldung runden die Steuer je Teil
      payments.push({
        kind: "kategorie",
        date: a.date,
        amount: a.amount,
        kategorie: a.directCategory,
        steuersatz: a.directTaxRate,
        group: a.reversesId ?? a.id,
      });
    } else if (isLohnZahlung(a.kind)) {
      // Lohn, Lohnsteuer und Beiträge: Ausgaben für Personal, wenn sie von der Bank abfließen (§ 11 Abs. 2 Satz 1 EStG)
      payments.push({ kind: "lohn", date: a.date, amount: a.amount, group });
    }
  }
  for (const w of exchangeDifferences) {
    const group = `kurs|${w.transactionId}|${w.invoiceId ?? w.documentId}`;
    if (w.invoiceId) {
      payments.push({
        kind: "invoice",
        date: w.date,
        paid: w.amount,
        totals: invoiceTotals.get(w.invoiceId)!,
        ...(w.taxShares
          ? { shares: recordedTaxShares(invoiceTotals.get(w.invoiceId)!, w.amount, w.taxSharesInvoiceId === w.invoiceId ? w.taxShares : null) }
          : {}),
        treatment: w.treatment ?? "regulaer",
        group,
      });
    } else if (w.documentId) {
      payments.push({
        kind: "document",
        date: w.date,
        paid: -w.amount,
        totals: docTotals.get(w.documentId)!,
        category: isCategory(w.category) ? w.category : "sonstiges",
        vorsteuerAbzug: w.vorsteuerAbzug ?? true,
        privateShare: w.privateShare ?? 0,
        ...belegAngaben(w.documentId),
        group,
      });
    }
    // Rechnung: weniger erhalten (Rest positiv) ist Verlust; Beleg: weniger gezahlt (Rest negativ) ist Gewinn
    payments.push({ kind: "kursdifferenz", date: w.date, amount: -w.amount, group });
  }
  for (const c of cashReceipts) {
    const totals = invoiceTotals.get(c.invoiceId!)!;
    payments.push({
      kind: "invoice",
      date: c.date,
      paid: c.amount,
      totals,
      shares: recordedTaxShares(totals, c.amount, c.taxSharesInvoiceId === c.invoiceId ? c.taxShares : null),
      treatment: c.treatment,
    });
  }
  for (const c of cashIncome) {
    if (!c.treatment || c.rate === null) continue;
    // Wie eine bezahlte Rechnung mit einem Steuersatz: dieselbe Zuordnung zu steuerpflichtig, steuerfrei und Kleinunternehmer
    const angabe = { behandlung: c.treatment, steuersatz: c.rate };
    const totals = bareinnahmeTotals(angabe, c.amount);
    payments.push({ kind: "invoice", date: c.date, paid: c.amount, totals, shares: totals.taxes, treatment: c.treatment, group: c.reversesId ?? c.id });
  }
  const documentPayment = (d: (typeof privateDocs)[number], date: string, paid: number): EuerPayment => ({
    kind: "document",
    date,
    paid,
    totals: docTotals.get(d.id)!,
    category: isCategory(d.category) ? d.category : "sonstiges",
    vorsteuerAbzug: d.vorsteuerAbzug,
    privateShare: d.privateShare,
    ...belegAngaben(d.id),
  });
  for (const d of privateDocs) payments.push(documentPayment(d, d.date!, d.gross));
  for (const d of cancelledDocs) payments.push(documentPayment(d, d.date, -d.gross));
  const pauschalen = await q
    .select({
      date: schema.pauschalen.date,
      amount: schema.pauschalen.amount,
      art: schema.pauschalen.art,
      id: schema.pauschalen.id,
      reversesId: schema.pauschalen.reversesId,
    })
    .from(schema.pauschalen)
    .where(and(gte(schema.pauschalen.date, `${year}-01-01`), lt(schema.pauschalen.date, `${year + 1}-01-01`)));
  for (const p of pauschalen) payments.push({ kind: "pauschale", date: p.date, amount: p.amount, art: p.art, group: p.reversesId ?? p.id });
  return payments;
}

/** Umsätze in den zehn Tagen um einen Jahreswechsel des Jahres (22.12. bis 10.01.), deren Zuordnung `art` erfüllt */
async function zahlungenUmJahreswechsel(year: number, art: SQL | undefined, q: Db | Tx): Promise<number> {
  const fenster = (y: number) => and(gte(schema.bankTransactions.bookingDate, `${y - 1}-12-22`), lte(schema.bankTransactions.bookingDate, `${y}-01-10`));
  const [row] = await q
    .select({ n: sql<number>`count(distinct ${schema.allocations.transactionId})`.mapWith(Number) })
    .from(schema.allocations)
    .innerJoin(schema.bankTransactions, eq(schema.bankTransactions.id, schema.allocations.transactionId))
    .where(
      and(
        art,
        // Aufgehobene Zuordnungen zählen nicht: weder die Gegenzeile noch die aufgehobene Zeile selbst
        isNull(schema.allocations.reversesId),
        sql`not exists (select 1 from allocations r where r.reverses_id = ${schema.allocations.id})`,
        or(fenster(year), fenster(year + 1)),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Lohnzahlungen in den zehn Tagen um einen Jahreswechsel des Jahres (22.12. bis 10.01.). Regelmäßig wiederkehrende Ausgaben
 * gehören dann in das Jahr, zu dem sie wirtschaftlich gehören (§ 11 Abs. 2 Satz 2 EStG, etwa die Lohnsteuer für Dezember,
 * fällig am 10. Januar nach § 41a Abs. 1 EStG). Welchem Monat eine Zahlung gilt, weiß Haben nicht; es zählt sie am Tag
 * der Zahlung und weist auf sie hin.
 */
export async function lohnZahlungenUmJahreswechsel(year: number, q: Db | Tx = db): Promise<number> {
  return zahlungenUmJahreswechsel(year, inArray(schema.allocations.kind, [...LOHN_ZAHLUNGEN]), q);
}

/**
 * Umsatzsteuer früherer Jahre (Steuerzahlung) in den zehn Tagen um einen Jahreswechsel. Eine Abschlusszahlung aus der
 * Jahreserklärung zählt im Jahr der Zahlung; ist es aber die Vorauszahlung für Dezember bzw. das vierte Quartal, gehört sie
 * als Voranmeldung zugeordnet. Dann zählt die EÜR sie im Vorjahr, wenn sie dort fällig war (§ 11 Abs. 2 Satz 2 EStG,
 * euer-jahreswechsel.ts).
 */
export async function umsatzsteuerVorjahreUmJahreswechsel(year: number, q: Db | Tx = db): Promise<number> {
  return zahlungenUmJahreswechsel(
    year,
    and(eq(schema.allocations.kind, "steuer"), eq(schema.allocations.taxType, "ust"), eq(schema.allocations.taxItem, "steuer")),
    q,
  );
}

/** Die EÜR aus den Nebenbüchern (Zahlungen, Belege, Pauschalen, Anlagenverzeichnis); ab dem Stichjahr die Gegenprobe */
export async function euerAusNebenbuechern(year: number, q: Db | Tx = db): Promise<EuerResult> {
  const euer = computeEuer(year, await euerPayments(year, q), await depreciationForEuer(year, q), await withdrawalsForEuer(year, q));
  // Freie Buchungen gibt es in der EÜR nur im Einzelunternehmen; manuelle Buchungen einer GmbH sind Abschlussbuchungen
  return isKapitalgesellschaft((await loadCompany(q)).rechtsform) ? euer : mitFreienBuchungen(euer, q);
}

/**
 * Die EÜR eines Jahres: ab dem Stichjahr aus dem Journal (#542, euer-quelle.ts), davor aus den Nebenbüchern. Nur im
 * Einzelunternehmen: GmbH und UG bilanzieren (#567); ihre Übersicht nach Zahlung bleibt aus den Nebenbüchern, sonst
 * zählten Abschlussbuchungen wie Rückstellungen als Ausgabe ohne Zahlung (Entwurf, Entscheidung 3).
 */
export async function euerForYear(year: number, q: Db | Tx = db): Promise<EuerResult> {
  if (year < (await journalAbJahr(q)) || isKapitalgesellschaft((await loadCompany(q)).rechtsform)) return euerAusNebenbuechern(year, q);
  return euerAusDemJournal(year, q);
}

export interface OpenPosition {
  id: string;
  number: string;
  party: string;
  date: string;
  dueDate: string;
  gross: number;
  open: number;
  /** Tage seit Fälligkeit; 0 = heute fällig, negativ = noch nicht fällig */
  daysOverdue: number;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Erledigt je Beleg: Zuordnungen und Ausbuchungen (erhaltenes Skonto), wie im Bankabgleich */
async function paidSums(ids: string[]) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await db.execute<{ id: string; paid: string }>(
    sql`select id, sum(amount) as paid from (
          select document_id as id, amount from allocations where document_id in ${ids}
          union all select document_id as id, amount from write_offs where document_id in ${ids}
        ) settled group by 1`,
  );
  return new Map([...rows].map((r) => [r.id, Number(r.paid)]));
}

/**
 * Offene Forderungen (festgeschriebene Rechnungen und Korrekturen, nicht storniert, dazu zu erstattende Beträge aus
 * Stornos bezahlter Rechnungen) und offene Verbindlichkeiten (gebuchte, über die Bank zu zahlende Belege), nach
 * Fälligkeit sortiert. Offen ist, was die Rechnungsliste als offen zeigt (listInvoices, @haben/core lebenszyklus.ts).
 */
export async function openPositions(today: string) {
  const receivables: OpenPosition[] = (await listInvoices(today))
    .filter((i) => i.status === "final" && i.open !== 0)
    .map((i) => ({
      id: i.id,
      number: i.number ?? "",
      party: i.customer,
      date: i.issueDate,
      dueDate: i.dueDate,
      gross: i.gross,
      open: i.open,
      daysOverdue: daysBetween(i.dueDate, today),
    }));

  const documents = await db
    .select({
      id: schema.documents.id,
      number: schema.documents.invoiceNumber,
      supplier: schema.documents.supplierName,
      filename: schema.documents.filename,
      documentDate: schema.documents.documentDate,
      dueDate: schema.documents.dueDate,
      uploadedAt: schema.documents.uploadedAt,
      gross: schema.documents.gross,
    })
    .from(schema.documents)
    // Storniert ist nichts mehr zu zahlen (#237)
    .where(and(eq(schema.documents.status, "gebucht"), eq(schema.documents.payment, "bank"), documentNotCancelled()));
  const documentPaid = await paidSums(documents.map((d) => d.id));
  const payables: OpenPosition[] = documents
    .map((d) => {
      const date = d.documentDate ?? todayInGermany(d.uploadedAt);
      const dueDate = d.dueDate ?? date;
      // Zuordnungen tragen das Vorzeichen des Kontos (Ausgang negativ)
      return {
        id: d.id,
        number: d.number || d.filename,
        party: d.supplier || "–",
        date,
        dueDate,
        gross: d.gross,
        // Als Verbindlichkeit positiv; documentOpen rechnet mit dem Vorzeichen des Kontos
        open: -documentOpen(d.gross, documentPaid.get(d.id) ?? 0),
        daysOverdue: daysBetween(dueDate, today),
      };
    })
    .filter((d) => d.open !== 0);

  // Zahllast (positiv) und Erstattung (negativ) abgegebener Voranmeldungen; id ist der Zeitraum für den Link
  const vat: OpenPosition[] = (await ustvaPosten()).posten
    .filter((p) => p.offen !== 0)
    .map((p) => ({
      id: periodKey(p),
      number: `${vatPostenLabel(p)}${p.berichtigt ? " (Berichtigung)" : ""}`,
      party: "Finanzamt",
      date: p.faellig,
      dueDate: p.faellig,
      gross: p.betrag,
      open: p.offen,
      // Eine Erstattung ist nicht überfällig: Wann sie kommt, entscheidet das Finanzamt
      daysOverdue: p.offen > 0 ? daysBetween(p.faellig, today) : -1,
    }));

  const byDue = (a: OpenPosition, b: OpenPosition) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number);
  receivables.sort(byDue);
  payables.sort(byDue);
  const total = (items: OpenPosition[]) => items.reduce((s, i) => s + i.open, 0);
  const overdue = (items: OpenPosition[]) => items.filter((i) => i.daysOverdue > 0);
  return {
    receivables,
    payables,
    receivablesTotal: total(receivables),
    payablesTotal: total(payables),
    receivablesOverdue: total(overdue(receivables)),
    payablesOverdue: total(overdue(payables)),
    vat,
    vatTotal: total(vat),
    vatOverdue: total(overdue(vat)),
  };
}

/** Jahre mit Bankumsätzen, Rechnungen oder Belegen, für die Jahresauswahl */
export async function reportYears(): Promise<number[]> {
  const rows = await db.execute<{ year: number }>(sql`
    select distinct extract(year from d)::int as year from (
      select booking_date as d from bank_transactions where bank_account_id not in (select id from bank_accounts where excluded_at is not null)
      union all select issue_date from invoices where status = 'final'
      union all select document_date from documents where status = 'gebucht' and document_date is not null
    ) dates order by 1`);
  return [...rows].map((r) => Number(r.year));
}
