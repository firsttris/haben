import {
  ACCOUNTS,
  invoicePaymentPosting,
  recordedTaxShares,
  zahlungMitBemessungWieHeute,
  type JournalZeile,
  type Kontenrahmen,
  type TaxShare,
} from "@haben/core";
import { and, inArray } from "drizzle-orm";
import { schema, type Db, type Tx } from "../../db/index.ts";
import { invoiceTaxReader, invoiceTotalsById } from "../rechnungen/index.ts";
import { zahlungAusAlterVersion } from "./alte-version.ts";

/*
 * Zahlungen auf Ausgangsrechnungen bei Ist aus Versionen vor #552 (bis v0.6) tragen keine Bemessungsgrundlage (#1502,
 * zahlungMitBemessungWieHeute in @haben/core). Voranmeldung, Verprobung und „Vorgang gegen Buchung“ lesen sie mit den
 * Zeilen, die Haben heute aus Rechnung, Betrag und gespeichertem Anteil bucht (wie der Storno einer solchen Bareinnahme,
 * bank/cash.ts), wenn diese auf Forderung und Umsatzsteuer denselben Saldo ergeben. Gebucht bleibt, wie es ist. Nur für
 * Buchungen von vor dem Update auf das Journal und ihre Stornos (zahlungAusAlterVersion): Eine neue Zahlung ohne
 * Bemessungsgrundlage wäre ein Fehler, den die Verprobung zeigen soll.
 */

export interface ZahlungsBuchung {
  /** Die Buchung (journal_entries.id) */
  id: string;
  sourceType: string;
  sourceId: string;
  kontenrahmen: Kontenrahmen;
  zeilen: JournalZeile[];
}

interface Vorgang {
  invoiceId: string | null;
  amount: number;
  taxShares: TaxShare[] | null;
  taxSharesInvoiceId: string | null;
}

/** Zuordnung im Bankabgleich oder Bareinnahme auf eine Rechnung, deren Buchung keine Bemessungsgrundlage trägt */
const ohneBemessung = (b: ZahlungsBuchung) =>
  (b.sourceType === "allocation" || b.sourceType === "kasse") &&
  !b.zeilen.some((z) => z.basis != null) &&
  b.zeilen.some((z) => z.account === ACCOUNTS[b.kontenrahmen].forderungen);

async function inBloecken<T>(ids: string[], lade: (block: string[]) => Promise<T[]>): Promise<T[]> {
  const result: T[] = [];
  for (let i = 0; i < ids.length; i += 5000) result.push(...(await lade(ids.slice(i, i + 5000))));
  return result;
}

/** Die Buchungen, Zahlungen von vor #552 mit der Bemessungsgrundlage wie heute; alle anderen unverändert */
export async function zahlungenWieHeute<B extends ZahlungsBuchung>(buchungen: readonly B[], q: Db | Tx): Promise<B[]> {
  const ohne = buchungen.filter(ohneBemessung);
  if (ohne.length === 0) return [...buchungen];
  const e = schema.journalEntries;
  const alt = new Set(
    (
      await inBloecken(
        ohne.map((b) => b.id),
        (ids) =>
          q
            .select({ id: e.id })
            .from(e)
            .where(and(inArray(e.id, ids), zahlungAusAlterVersion)),
      )
    ).map((r) => r.id),
  );
  const kandidaten = ohne.filter((b) => alt.has(b.id));
  if (kandidaten.length === 0) return [...buchungen];
  const quelle = (typ: string) => [...new Set(kandidaten.filter((b) => b.sourceType === typ).map((b) => b.sourceId))];
  const a = schema.allocations;
  const c = schema.cashEntries;
  const felder = <T extends typeof a | typeof c>(t: T) => ({
    id: t.id,
    invoiceId: t.invoiceId,
    amount: t.amount,
    taxShares: t.taxShares,
    taxSharesInvoiceId: t.taxSharesInvoiceId,
  });
  const vorgaenge = new Map<string, Vorgang>([
    ...(await inBloecken(quelle("allocation"), (ids) => q.select(felder(a)).from(a).where(inArray(a.id, ids)))).map((r) => [`allocation:${r.id}`, r] as const),
    ...(await inBloecken(quelle("kasse"), (ids) => q.select(felder(c)).from(c).where(inArray(c.id, ids)))).map((r) => [`kasse:${r.id}`, r] as const),
  ]);
  const invoiceIds = [...new Set([...vorgaenge.values()].flatMap((v) => (v.invoiceId ? [v.invoiceId] : [])))];
  if (invoiceIds.length === 0) return [...buchungen];
  const totals = await invoiceTotalsById(invoiceIds, q);
  const rechnungen = new Map(
    (await inBloecken(invoiceIds, (ids) => q.select().from(schema.invoices).where(inArray(schema.invoices.id, ids)))).map((r) => [r.id, r]),
  );
  const taxes = invoiceTaxReader(q);
  const ist = new Set<string>();
  for (const r of rechnungen.values()) if ((await taxes.paymentPostingMode(r)) === "ist") ist.add(r.id);
  return buchungen.map((b) => {
    if (!alt.has(b.id) || !ohneBemessung(b)) return b;
    const v = vorgaenge.get(`${b.sourceType}:${b.sourceId}`);
    const rechnung = v?.invoiceId ? rechnungen.get(v.invoiceId) : undefined;
    const t = rechnung ? totals.get(rechnung.id) : undefined;
    if (!v || !rechnung || !t || !ist.has(rechnung.id)) return b;
    const shares = recordedTaxShares(t, v.amount, v.taxSharesInvoiceId === rechnung.id ? v.taxShares : null);
    const heute = invoicePaymentPosting(t, v.amount, b.kontenrahmen, "ist", shares, rechnung.taxTreatment);
    return { ...b, zeilen: zahlungMitBemessungWieHeute(b.kontenrahmen, b.zeilen, heute) };
  });
}
