import { computeInvoiceTotals, paidTaxShares, splitPrivateShare, type Cents, type InvoiceTotals, type TaxTreatment, type VatPeriod } from "@haben/core";
import { and, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { privateUseForMonth } from "./assets.ts";
import { loadCompany } from "./company.ts";
import { db, schema } from "./db/index.ts";

export interface RevenueSource {
  /** payment = Zahlungseingang (Ist), invoice = Rechnung (Soll), entnahme = private Kfz-Nutzung */
  type: "payment" | "invoice" | "entnahme";
  /** Bei Entnahmen: das Fahrzeug */
  assetId?: string;
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
  /** Regulär besteuerte Umsätze zu 0 %, die in dieser Voranmeldung nicht gemeldet werden */
  steuerfrei: Cents;
  revenue: RevenueSource[];
  inputTax: InputTaxSource[];
  reverseCharge: ReverseChargeSource[];
}

function monthRange({ year, month }: VatPeriod) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { start, end };
}

async function invoiceTotals(ids: string[]): Promise<Map<string, InvoiceTotals>> {
  if (ids.length === 0) return new Map();
  const lines = await db.select().from(schema.invoiceLines).where(inArray(schema.invoiceLines.invoiceId, ids));
  const byInvoice = new Map<string, typeof lines>();
  for (const line of lines) byInvoice.set(line.invoiceId, [...(byInvoice.get(line.invoiceId) ?? []), line]);
  return new Map(
    [...byInvoice].map(([id, rows]) => [id, computeInvoiceTotals(rows.map((r) => ({ ...r, taxRate: r.taxRate as 1900 | 700 | 0 })))]),
  );
}

/**
 * Kennzahlen eines Monats aus den Buchungen. Ist-Versteuerung: Umsatzsteuer nach Datum des
 * zugeordneten Zahlungseingangs, bei Teilzahlungen anteilig. Soll: nach Rechnungsdatum.
 * Vorsteuer in beiden Fällen nach Belegdatum.
 */
export async function computeVatFigures(period: VatPeriod): Promise<VatFigures> {
  const { start, end } = monthRange(period);
  const company = await loadCompany();
  const revenue: RevenueSource[] = [];

  if (company.versteuerung === "ist") {
    const payments = await db
      .select({
        date: schema.bankTransactions.bookingDate,
        amount: schema.allocations.amount,
        invoiceId: schema.invoices.id,
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
          // Reverse Charge zählt im Monat der Rechnung, auch bei Ist-Versteuerung (siehe unten)
          ne(schema.invoices.taxTreatment, "reverse_charge"),
        ),
      );
    const totals = await invoiceTotals([...new Set(payments.map((p) => p.invoiceId))]);
    for (const p of payments) {
      for (const share of paidTaxShares(totals.get(p.invoiceId)!, p.amount)) {
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

  // Soll: alle Rechnungen nach Rechnungsdatum. Ist: nur Reverse Charge, die Meldung in Kz 21
  // richtet sich nach der Leistung, nicht nach der Zahlung (Rechnungsdatum als Näherung).
  {
    const issued = await db
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.status, "final"),
          gte(schema.invoices.issueDate, start),
          lt(schema.invoices.issueDate, end),
          // aus Lexoffice übernommen: die Steuer ist dort schon angemeldet
          isNull(schema.invoices.lexofficeVoucherId),
          ...(company.versteuerung === "ist" ? [eq(schema.invoices.taxTreatment, "reverse_charge")] : []),
        ),
      );
    const totals = await invoiceTotals(issued.map((i) => i.id));
    for (const inv of issued) {
      for (const t of totals.get(inv.id)?.taxes ?? []) {
        revenue.push({
          type: "invoice",
          date: inv.issueDate,
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

  // Private Kfz-Nutzung: unentgeltliche Wertabgabe im Monat der Nutzung, auch bei Ist-Versteuerung
  const lastDay = new Date(Date.UTC(period.year, period.month, 0)).toISOString().slice(0, 10);
  for (const use of await privateUseForMonth(period.year, period.month)) {
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

  const amounts = await db
    .select({
      documentId: schema.documents.id,
      date: schema.documents.documentDate,
      supplier: schema.documents.supplierName,
      number: schema.documents.invoiceNumber,
      rate: schema.documentAmounts.taxRate,
      base: schema.documentAmounts.net,
      tax: schema.documentAmounts.tax,
      privateShare: schema.documents.privateShare,
      vorsteuerAbzug: schema.documents.vorsteuerAbzug,
      reverseCharge: schema.documents.reverseCharge,
    })
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
  // Mit Privatanteil zählt nur der betriebliche Teil; Kleinunternehmer ziehen keine Vorsteuer ab
  const inputTax = amounts
    .filter((a) => a.vorsteuerAbzug && !a.reverseCharge)
    .map(({ privateShare, vorsteuerAbzug: _abzug, reverseCharge: _rc, ...a }) => ({
      ...a,
      date: a.date!,
      base: splitPrivateShare(a.base, privateShare).business,
      tax: splitPrivateShare(a.tax, privateShare).business,
    }))
    .filter((a) => a.tax !== 0);
  // § 13b: Bemessungsgrundlage und Steuer voll, auch bei Privatanteil; Vorsteuer nur betrieblich
  const reverseCharge: ReverseChargeSource[] = amounts
    .filter((a) => a.reverseCharge)
    .map(({ privateShare, vorsteuerAbzug, reverseCharge: rc, ...a }) => ({
      ...a,
      date: a.date!,
      reverseCharge: rc!,
      deductible: vorsteuerAbzug ? splitPrivateShare(a.tax, privateShare).business : 0,
    }));
  const rcSum = (kind: "eu" | "drittland", key: "base" | "tax") =>
    reverseCharge.filter((r) => r.reverseCharge === kind).reduce((s, r) => s + r[key], 0);

  const regular = revenue.filter((r) => r.treatment === "regulaer");
  const sum = (rows: { base: Cents; tax: Cents; rate: number }[], rate: number, key: "base" | "tax") =>
    rows.filter((r) => r.rate === rate).reduce((s, r) => s + r[key], 0);
  const treated = (treatment: TaxTreatment) => revenue.filter((r) => r.treatment === treatment).reduce((s, r) => s + r.base, 0);

  return {
    versteuerung: company.versteuerung,
    kleinunternehmer: company.kleinunternehmer,
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
    steuerfrei: sum(regular, 0, "base"),
    revenue,
    inputTax,
    reverseCharge,
  };
}

export interface PreflightIssue {
  tone: "warn" | "info";
  text: string;
  link: "/bank" | "/belege" | "/rechnungen";
}

/** Vorprüfung vor dem Senden: was im Zeitraum noch offen ist und die Zahlen verfälschen könnte */
export async function preflight(period: VatPeriod, figures: VatFigures): Promise<PreflightIssue[]> {
  const { start, end } = monthRange(period);
  const issues: PreflightIssue[] = [];
  const open = sql`(${schema.bankTransactions.amount} - coalesce((select sum(a.amount) from allocations a where a.transaction_id = bank_transactions.id), 0))`;

  const [bank] = await db
    .select({
      incoming: sql<number>`count(*) filter (where ${schema.bankTransactions.amount} > 0)::int`,
      outgoing: sql<number>`count(*) filter (where ${schema.bankTransactions.amount} < 0)::int`,
    })
    .from(schema.bankTransactions)
    .where(and(gte(schema.bankTransactions.bookingDate, start), lt(schema.bankTransactions.bookingDate, end), sql`${open} <> 0`));
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
