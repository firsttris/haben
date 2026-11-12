import {
  computeEuer,
  documentPosting,
  EXPENSE_CATEGORIES,
  invoicePosting,
  leereEuerAusJournal,
  totalsFromTaxes,
  type AllocatedSplitLine,
  type EuerAusJournal,
  type EuerPayment,
  type ExpenseCategory,
  type Kontenrahmen,
  type TaxTreatment,
} from "@haben/core";
import { eq, inArray } from "drizzle-orm";
import { schema, type Db, type Tx } from "../../db/index.ts";
import { splitsByDocument } from "../belege/index.ts";
import { invoiceTotalsById } from "../rechnungen/index.ts";
import { bloecke, offenerPosten, type Zeile } from "./euer-journal-buchungen.ts";

/*
 * Was die EÜR aus dem Journal (euer-journal.ts) aus dem Nebenbuch braucht, weil die Buchung allein es nicht hergibt: die
 * Rundung von Teilzahlungen auf Belege mit Privatanteil oder ohne Vorsteuerabzug und die Zeilen übernommener
 * Lexoffice-Posten, deren Buchung gegen den Saldenvortrag steht.
 */

/** Aufteilung eines Belegs aus dem Nebenbuch, für Teilzahlungen, deren Rundung die Buchung allein nicht hergibt */
export interface BelegNebenbuch {
  totals: ReturnType<typeof totalsFromTaxes>;
  category: ExpenseCategory;
  vorsteuerAbzug: boolean;
  privateShare: number;
  splits?: AllocatedSplitLine[];
  /** § 13b und Erwerb: selbst geschuldete Steuer je Steuersatz */
  selbstGeschuldet?: number[];
}

/** Aufteilung je Beleg aus dem Nebenbuch, für alle `ids` gesammelt geladen; Belege, die keine brauchen, fehlen in der Map */
export async function belegNebenbuecher(q: Db | Tx, ids: string[]): Promise<Map<string, BelegNebenbuch>> {
  const d = schema.documents;
  const result = new Map<string, BelegNebenbuch>();
  for (const block of bloecke([...new Set(ids)])) {
    const docs = await q
      .select({ id: d.id, category: d.category, vorsteuerAbzug: d.vorsteuerAbzug, privateShare: d.privateShare, reverseCharge: d.reverseCharge })
      .from(d)
      .where(inArray(d.id, block));
    // Nur mit Privatanteil oder ohne Vorsteuerabzug: computeEuer teilt dann erst nach Satz bzw. Zeile der Aufteilung, danach
    // privat bzw. die Steuer zu; die Buchung fasst den privaten Teil bzw. Netto und Steuer zusammen
    const noetig = docs.filter((doc) => !(doc.privateShare === 0 && doc.vorsteuerAbzug));
    if (noetig.length === 0) continue;
    const noetigIds = noetig.map((doc) => doc.id);
    const amounts = new Map<string, (typeof schema.documentAmounts.$inferSelect)[]>();
    for (const a of await q.select().from(schema.documentAmounts).where(inArray(schema.documentAmounts.documentId, noetigIds)))
      amounts.set(a.documentId, [...(amounts.get(a.documentId) ?? []), a]);
    const splitsJe = await splitsByDocument(noetigIds, q);
    for (const doc of noetig) {
      // § 13b und Erwerb: gezahlt ist nur netto, auch je Zeile der Aufteilung (wie reports.ts)
      const rows = (amounts.get(doc.id) ?? []).map((a) => ({ rate: a.taxRate, base: a.net, tax: doc.reverseCharge ? 0 : a.tax }));
      const splits = splitsJe.get(doc.id)?.map((line) => (doc.reverseCharge ? { ...line, tax: 0 } : line));
      const category = doc.category && doc.category in EXPENSE_CATEGORIES ? (doc.category as ExpenseCategory) : "sonstiges";
      result.set(doc.id, {
        totals: totalsFromTaxes(rows),
        category,
        vorsteuerAbzug: doc.vorsteuerAbzug,
        privateShare: doc.privateShare,
        ...(splits ? { splits } : {}),
        ...(doc.reverseCharge ? { selbstGeschuldet: (amounts.get(doc.id) ?? []).map((a) => a.tax) } : {}),
      });
    }
  }
  return result;
}

/** Wirkung einer Teilzahlung auf einen Beleg, gerechnet wie computeEuer */
export function belegTeilzahlung(year: number, beleg: BelegNebenbuch, paid: number, summe: EuerAusJournal = leereEuerAusJournal()): EuerAusJournal {
  const payment: EuerPayment = { kind: "document", date: `${year}-06-30`, paid, ...beleg };
  const result = computeEuer(year, [payment]);
  for (const l of [...result.einnahmen, ...result.ausgaben]) if (l.amount !== 0) summe.zeilen[l.key] = (summe.zeilen[l.key] ?? 0) + l.amount;
  summe.bewirtungNichtAbziehbar += result.bewirtungNichtAbziehbar;
  return summe;
}

/**
 * Zeilen, die Haben für eine aus Lexoffice übernommene Rechnung bzw. einen übernommenen Beleg buchen würde: Deren Buchung
 * steht gegen den Saldenvortrag (Erlös bzw. Aufwand stehen in den alten Büchern), in Haben fließt aber erst die Zahlung.
 * Gebaut mit denselben Buchungsfunktionen aus Summen und Angaben des Nebenbuchs; null, wenn sie fehlen.
 */
export async function uebernommeneZeilen(
  q: Db | Tx,
  typ: "invoice" | "document",
  id: string,
  kr: Kontenrahmen,
): Promise<{ zeilen: Zeile[]; gesamt: number } | null> {
  if (typ === "invoice") {
    const totals = (await invoiceTotalsById([id], q)).get(id);
    const [invoice] = await q.select({ treatment: schema.invoices.taxTreatment }).from(schema.invoices).where(eq(schema.invoices.id, id));
    if (!totals || !invoice) return null;
    const lines = invoicePosting(totals, kr, "soll", invoice.treatment as TaxTreatment);
    return {
      zeilen: lines.filter((z) => !offenerPosten(kr, z)),
      gesamt: lines.filter((z) => offenerPosten(kr, z)).reduce((s, z) => s + z.debit - z.credit, 0),
    };
  }
  const d = schema.documents;
  const [doc] = await q
    .select({ category: d.category, vorsteuerAbzug: d.vorsteuerAbzug, privateShare: d.privateShare, reverseCharge: d.reverseCharge })
    .from(d)
    .where(eq(d.id, id));
  if (!doc?.category || !(doc.category in EXPENSE_CATEGORIES)) return null;
  const amounts = await q.select().from(schema.documentAmounts).where(eq(schema.documentAmounts.documentId, id));
  const totals = totalsFromTaxes(amounts.map((a) => ({ rate: a.taxRate, base: a.net, tax: a.tax })));
  // § 13b und Erwerb: gezahlt ist nur netto (documentPosting)
  const gezahlt = doc.reverseCharge ? { ...totals, gross: totals.net } : totals;
  const lines = documentPosting(
    gezahlt,
    doc.category as ExpenseCategory,
    kr,
    "einzelunternehmen",
    "bank",
    doc.vorsteuerAbzug,
    undefined,
    doc.privateShare,
    doc.reverseCharge,
  );
  return { zeilen: lines.filter((z) => !offenerPosten(kr, z)), gesamt: lines.filter((z) => offenerPosten(kr, z)).reduce((s, z) => s + z.debit - z.credit, 0) };
}
