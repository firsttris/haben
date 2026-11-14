import { LEGACY_PAYMENT_TYPES, settlementTaxShares, type TaxShare, type TurnoverClassification } from "@haben/core";
import { eq, inArray, isNotNull, sql } from "drizzle-orm";
import { schema, type Db, type Tx } from "../../db/index.ts";
import {
  effectiveAmount,
  effectiveDirection,
  effectivePayment,
  effectiveTaxes,
  legacyTakeoverCutoff,
  paymentHistoryIssue,
  taxTypeOf,
  unclearFrom,
} from "../archiv/index.ts";
import { turnoverRange, unknownTurnover, type GesamtumsatzItem } from "./gesamtumsatz-quellen.ts";

/** Nur die ausdrücklich gespeicherte Steuerart, nie Konto, Rechnungstext oder Kundenland. */
export function legacyTurnoverClassification(taxType: string | null): TurnoverClassification | null {
  switch (taxType) {
    case "net":
    case "gross":
    case "constructionService13b":
    case "photovoltaicEquipment":
      return { kind: "domestic" };
    case "vatfree":
      return { kind: "section4", provision: null, ancillary: null };
    case "thirdPartyCountryService":
    case "externalService13b":
      return { kind: "foreign", confirmed: false };
    case "thirdPartyCountryDelivery":
      return { kind: "section4", provision: { number: "1", letter: "a" }, ancillary: null };
    case "intraCommunitySupply":
      return { kind: "section4", provision: { number: "1", letter: "b" }, ancillary: null };
    default:
      return null;
  }
}

async function archiveRows(q: Db | Tx) {
  const v = schema.lexofficeVouchers;
  return q
    .select({
      id: v.id,
      source: v.source,
      status: v.status,
      number: v.number,
      date: v.date,
      currency: v.currency,
      net: effectiveAmount("lexoffice_vouchers", "net"),
      tax: effectiveAmount("lexoffice_vouchers", "tax"),
      gross: effectiveAmount("lexoffice_vouchers", "gross"),
      taxes: effectiveTaxes("lexoffice_vouchers"),
      payment: effectivePayment("lexoffice_vouchers"),
      taxType: sql<string | null>`${taxTypeOf("lexoffice_vouchers")}`,
      payDate: sql<string | null>`${v.raw}->>'payDate'`,
    })
    .from(v)
    .where(eq(effectiveDirection("lexoffice_vouchers"), "einnahme"));
}

type Voucher = Awaited<ReturnType<typeof archiveRows>>[number];

function paymentProblem(v: Voucher): string | null {
  if (v.payment?.history === "storno") return null;
  const existing = paymentHistoryIssue(v);
  if (existing) return existing;
  if (!v.payment)
    return ["paid", "partlyPaid", "unknown"].includes(v.status)
      ? "Der historische Zahlungsstatus belegt weder einzelne Beträge noch deren Zahlungstage."
      : null;
  if (!v.payment.items.length && (v.status === "paid" || v.status === "partlyPaid" || Math.abs(v.payment.openAmount) !== Math.abs(v.gross)))
    return "Die historische Zahlungsverdichtung belegt keine vollständigen Einzelzahlungen.";
  if (v.payment.items.some((p) => p.amount !== 0 && (!p.date || !Number.isSafeInteger(p.amount))))
    return "Einzelzahlungen enthalten ein unbekanntes Datum oder einen unbekannten Betrag.";
  const signs = new Set(v.payment.items.filter((p) => p.amount !== 0).map((p) => Math.sign(p.amount)));
  const sum = v.payment.items.reduce((total, p) => total + Math.abs(p.amount), 0);
  if (signs.size > 1 || sum !== Math.abs(v.gross) - Math.abs(v.payment.openAmount))
    return "Die Einzelzahlungen erklären den historischen Zahlungsstand nicht vollständig oder enthalten ungeklärte Rückbuchungen.";
  return null;
}

function legacyItems(v: Voucher, year: number, cutoff: string | undefined): GesamtumsatzItem[] {
  const { start, end } = turnoverRange(year);
  if (v.payment?.history === "storno") return [];
  const problem = paymentProblem(v);
  if (problem) {
    if (paymentHistoryIssue(v) && !unclearFrom(v, start)) return [];
    return [unknownTurnover("legacy", `history:${v.id}`, v.number || "Historischer Zahlungsstand", null, null, problem)];
  }
  const classification = legacyTurnoverClassification(v.taxType);
  const totals = { net: v.net, tax: v.tax, gross: v.gross, taxes: v.taxes.map((t) => ({ rate: t.rate, base: t.net, tax: t.tax })) };
  let settled = 0;
  const recorded: TaxShare[] = [];
  return (v.payment?.items ?? []).flatMap((payment, index) => {
    if (payment.amount === 0) return [];
    const monetary = LEGACY_PAYMENT_TYPES.has(payment.type) && payment.type !== "partPaymentCreditNote";
    const shares = monetary && totals.gross !== 0 && totals.taxes.length ? settlementTaxShares(totals, settled, recorded, payment.amount) : null;
    if (shares) {
      settled += payment.amount;
      recorded.push(...shares);
    }
    if (payment.date < start || payment.date >= end || (cutoff && payment.date > cutoff)) return [];
    const item = unknownTurnover(
      "legacy",
      `${v.id}:${index}`,
      v.number || "Historische Zahlung",
      payment.date,
      payment.amount,
      "Die historische Zahlung ist keiner ausreichend geklärten Ausgangsleistung zugeordnet.",
    );
    if (["cashDiscount", "irrecoverableReceivable"].includes(payment.type)) return [{ ...item, classification: { kind: "not_turnover" } as const }];
    if (payment.type === "partPaymentCreditNote") return [{ ...item, uncertainty: "Die Verrechnung hat keinen bestätigten Bezug auf vereinnahmtes Entgelt." }];
    if (v.currency !== "EUR" || !shares) return [item];
    return [
      {
        ...item,
        classification,
        net: shares.reduce((sum, p) => sum + p.base, 0),
        basisSource: "derived" as const,
        uncertainty: classification ? undefined : item.uncertainty,
      },
    ];
  });
}

/** Archivzahlungen bis zum bestätigten Übernahmestichtag, danach Zahlungen aus den nativen Nebenbüchern. */
export async function legacyTurnoverItems(year: number, q: Db | Tx): Promise<GesamtumsatzItem[]> {
  const [rows, takenOver] = await Promise.all([
    archiveRows(q),
    q.select({ id: schema.invoices.lexofficeVoucherId }).from(schema.invoices).where(isNotNull(schema.invoices.lexofficeVoucherId)),
  ]);
  const ids = new Set(takenOver.map((v) => v.id));
  const cutoff = ids.size ? await legacyTakeoverCutoff(undefined, q) : null;
  return rows.flatMap((v) => legacyItems(v, year, ids.has(v.id) ? cutoff?.date : undefined));
}

/** Übernommene §-4-/Auslandsfälle dürfen durch die frühere pauschale „regulaer“-Übernahme nicht geklärt erscheinen. */
export async function takenOverClassifications(ids: string[], q: Db | Tx) {
  const result = new Map<string, TurnoverClassification | null>();
  const v = schema.lexofficeVouchers;
  for (let i = 0; i < ids.length; i += 5000) {
    const rows = await q
      .select({ id: v.id, taxType: sql<string | null>`${taxTypeOf("lexoffice_vouchers")}` })
      .from(v)
      .where(inArray(v.id, ids.slice(i, i + 5000)));
    for (const row of rows) result.set(row.id, legacyTurnoverClassification(row.taxType));
  }
  return result;
}
