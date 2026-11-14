import type { EuerPayment } from "./euer.ts";
import { allocateSplitTax } from "./document-split.ts";
import { roundHalfAwayFromZero, splitPrivateShare, type Cents } from "./money.ts";
import { paidTaxShares, type ExpenseCategory, type TaxShare } from "./posting.ts";
import { abziehbareSteuer, gespeicherterAnteil } from "./vorsteuerabzug.ts";

type DocumentPayment = Extract<EuerPayment, { kind: "document" }>;
type Share = { category: ExpenseCategory; share: TaxShare; deductible: Cents };

export interface DocumentEuerEffect {
  expenses: { category: ExpenseCategory; amount: Cents }[];
  vorsteuer: Cents;
  bewirtungNichtAbziehbar: Cents;
  privateUst: Cents;
}

export interface DocumentEuerEvent {
  id: string;
  paid: Cents;
  reversesId: string | null;
}

/** Addiert bereits gerundete Wirkungen; Gegenzeilen nehmen exakt die Wirkung ihres Ursprungs zurück. */
export function addDocumentEffects(a: DocumentEuerEffect, b: DocumentEuerEffect, sign = 1): DocumentEuerEffect {
  const expenses = new Map<ExpenseCategory, Cents>();
  for (const e of a.expenses) expenses.set(e.category, (expenses.get(e.category) ?? 0) + e.amount);
  for (const e of b.expenses) expenses.set(e.category, (expenses.get(e.category) ?? 0) + sign * e.amount);
  return {
    expenses: [...expenses].map(([category, amount]) => ({ category, amount })),
    vorsteuer: a.vorsteuer + sign * b.vorsteuer,
    bewirtungNichtAbziehbar: a.bewirtungNichtAbziehbar + sign * b.bewirtungNichtAbziehbar,
    privateUst: a.privateUst + sign * b.privateUst,
  };
}

/**
 * Die Originalsteuer bleibt Grundlage der Zahlungsaufteilung; nur der nach § 15 Abs. 4 UStG zugeordnete Anteil ist
 * gezahlte Vorsteuer. Der Rest gehört zum Aufwand (§ 9b Abs. 1 EStG). Privatanteil und Abzugsanteil sind getrennt.
 * https://www.gesetze-im-internet.de/ustg_1980/__15.html; https://www.gesetze-im-internet.de/estg/__9b.html
 */
function documentShares(p: DocumentPayment, paid: Cents): Share[] {
  const anteil = (rate: number) => gespeicherterAnteil(p, p.totals.taxes.find((t) => t.rate === rate)?.vorsteuerAnteil);
  if (!p.splits?.length) {
    return paidTaxShares(p.totals, paid).map((share) => ({
      category: p.category,
      share,
      deductible: abziehbareSteuer(splitPrivateShare(share.tax, p.privateShare ?? 0).business, anteil(share.rate)),
    }));
  }
  const lines = p.splits;
  const shares = paidTaxShares({ ...p.totals, taxes: lines.map((l) => ({ rate: l.taxRate, base: l.net, tax: l.tax })) }, paid);
  // Der Abzug wird je Satz gerundet und auf die Kontierungszeilen verteilt, wie die Originalsteuer: Zwei kleine Zeilen
  // dürfen zusammen keinen zusätzlichen Cent Vorsteuer bekommen. Die größte Zeile trägt den Rundungsrest.
  const amounts = p.totals.taxes.map((t) => ({
    taxRate: t.rate,
    net: t.base,
    tax: abziehbareSteuer(
      shares.filter((s) => s.rate === t.rate).reduce((sum, s) => sum + s.tax, 0),
      anteil(t.rate),
    ),
  }));
  const deductible = allocateSplitTax(lines, amounts);
  return shares.map((share, i) => ({ category: lines[i]!.category, share, deductible: anteil(share.rate) === 10_000 ? share.tax : deductible[i]!.tax }));
}

/** Wirkung eines kumulierten Zahlbetrags, ohne AfA und Zahlungen ans Finanzamt */
function documentTarget(p: DocumentPayment, paid: Cents): DocumentEuerEffect {
  const expenses: { category: ExpenseCategory; amount: Cents }[] = [];
  let vorsteuer = 0;
  let bewirtungNichtAbziehbar = 0;
  for (const { category, share, deductible } of documentShares(p, paid)) {
    const base = splitPrivateShare(share.base, p.privateShare ?? 0).business;
    const tax = splitPrivateShare(share.tax, p.privateShare ?? 0).business;
    // Die reine Bescheidkategorie verlangt vollen Abzug; nicht abziehbare Einfuhrumsatzsteuer gehört zur Ware/Anlage.
    if (category === "einfuhrumsatzsteuer") {
      vorsteuer += share.base + share.tax;
      continue;
    }
    vorsteuer += deductible;
    // Der nicht abziehbare Teil einer Anlage gehört in die Anschaffungskosten und wirkt über die AfA.
    if (category === "anlage") continue;
    const ausgabe = base + tax - deductible;
    // § 4 Abs. 5 Satz 1 Nr. 2 EStG: Bei Bewirtung sind 70 % des Aufwands abziehbar.
    const nichtAbziehbar = category === "bewirtung" ? ausgabe - roundHalfAwayFromZero((ausgabe * 7) / 10) : 0;
    bewirtungNichtAbziehbar += nichtAbziehbar;
    expenses.push({ category, amount: ausgabe - nichtAbziehbar });
  }
  // Selbst geschuldete Steuer steckt nicht im Zahlbetrag an den Lieferanten; sie wirkt mit der Finanzamtszahlung.
  // Nur der private Teil zählt wie bisher als Umsatzsteuer auf die Entnahme (Anlage EÜR, Zeile 17).
  const privat = (p.selbstGeschuldet ?? []).reduce((sum, steuer) => sum + splitPrivateShare(steuer, p.privateShare ?? 0).private, 0);
  const privateUst = p.totals.gross === 0 ? 0 : roundHalfAwayFromZero((privat * paid) / p.totals.gross);
  return { expenses, vorsteuer, bewirtungNichtAbziehbar, privateUst };
}

/** Teilabzüge mit Zahlstand werden kumuliert gerundet; alte 100-/0-%-Wege rechnen weiter je Zahlung. */
export function documentEuer(p: DocumentPayment, paid: Cents): DocumentEuerEffect {
  if (p.effect) return p.effect;
  if (p.paidBefore === undefined) return documentTarget(p, paid);
  return addDocumentEffects(documentTarget(p, p.paidBefore + paid), documentTarget(p, p.paidBefore), -1);
}

/**
 * Wirkungen aus der vorhandenen Zahlungshistorie, ohne neue Speicherung. Jede reguläre Zahlung ergänzt das kumulierte
 * Ziel um den noch fehlenden Rest. Eine Rücknahme dreht die ursprüngliche Wirkung exakt um; die nächste Zahlung
 * berücksichtigt auch deren Rundungsrest, wie settlementTaxShares bei der Umsatzsteuer.
 */
export function documentEuerEffects(p: DocumentPayment, events: readonly DocumentEuerEvent[]): Map<string, DocumentEuerEffect> {
  const result = new Map<string, DocumentEuerEffect>();
  let paid = 0;
  let recorded = documentTarget(p, 0);
  for (const event of events) {
    paid += event.paid;
    const original = event.reversesId ? result.get(event.reversesId) : undefined;
    const effect = original ? addDocumentEffects(documentTarget(p, 0), original, -1) : addDocumentEffects(documentTarget(p, paid), recorded, -1);
    result.set(event.id, effect);
    recorded = addDocumentEffects(recorded, effect);
  }
  return result;
}
