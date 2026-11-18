import type { BasisPoints } from "./money.ts";
import type { TaxShare } from "./posting.ts";
import type { TaxTreatment } from "./treatment.ts";

/** § 18b UStG: EU-Leistungen und innergemeinschaftliche Lieferungen behalten ihre gesonderten Meldezeitpunkte. */
export const advanceUsesPayments = (treatment: TaxTreatment) => ["regulaer", "steuerfrei", "ausfuhr"].includes(treatment);

export interface AdvanceVatEvent {
  date: string;
  /** Tatsächlicher Zufluss, Erstattung bzw. Gegenzeile, mit den gespeicherten Steueranteilen. */
  paid?: TaxShare[];
  /** Minderung einer Forderung, kein Zahlungseingang. */
  writtenOff?: TaxShare[];
  /** Festgeschriebene Korrektur der Anforderung. */
  correction?: TaxShare[];
  /** Kennzeichen „rueckgewaehr“ der Korrektur: Bereits Vereinnahmtes mindert sich erst mit der Rückzahlung. */
  untilRefund?: boolean;
  /**
   * Korrektur ohne Kennzeichen (bisheriges Verfahren): Ihre Minderung wirkte schon mit dem Beleg. Ihr Betrag ist ein
   * Anspruch des Kunden (positiv), den Rückzahlung, Storno oder Verrechnung tilgen (negativ); er hält keine Steuer.
   */
  legacyClaim?: { id: string; shares: TaxShare[] };
  /** Schlussleistung bzw. deren Storno. */
  performance?: 1 | -1;
}

export interface AdvanceVatChange {
  date: string;
  shares: TaxShare[];
}

/** Differenz zweier mit advanceVatPlan berechneter Stände, ohne Rückrechnung aus Kontonummern. */
export function advanceVatDifference(before: readonly AdvanceVatChange[], after: readonly AdvanceVatChange[]): AdvanceVatChange[] {
  const days = new Map<string, Map<number, TaxShare>>();
  for (const [changes, sign] of [
    [before, -1],
    [after, 1],
  ] as const) {
    for (const { date, shares } of changes) {
      let rates = days.get(date);
      if (!rates) {
        rates = new Map();
        days.set(date, rates);
      }
      for (const share of shares) {
        const previous = rates.get(share.rate) ?? { rate: share.rate, base: 0, tax: 0 };
        rates.set(share.rate, { rate: share.rate, base: previous.base + sign * share.base, tax: previous.tax + sign * share.tax });
      }
    }
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rates]) => ({ date, shares: [...rates.values()].filter((s) => s.base || s.tax) }))
    .filter((d) => d.shares.length);
}

type Key = "base" | "tax";
const gross = (s: Pick<TaxShare, "base" | "tax">) => s.base + s.tax;

/** Laufender Stand einer Rechnung samt Korrekturen, Tag für Tag (advanceVatSchedule). */
interface Stand {
  paid: TaxShare[];
  writtenOff: TaxShare[];
  amount: TaxShare[];
  flagged: TaxShare[];
  claims: Map<string, TaxShare[]>;
  performed: number;
}

const sum = (shares: readonly TaxShare[], rate: BasisPoints, key: Key) => shares.filter((s) => s.rate === rate).reduce((n, s) => n + s[key], 0);

/**
 * Bis zur Rückzahlung gehaltene Steuer je Satz: Wurde mehr vereinnahmt als das geminderte Entgelt, mindert eine
 * gekennzeichnete Korrektur die Steuer auf diese Überzahlung erst mit der Rückgewähr (§ 17 Abs. 1 und Abs. 2 Nr. 2, 3
 * UStG). UStAE 17.1 Abs. 2 Satz 3: „Vereinbaren der leistende Unternehmer und der Leistungsempfänger die vollständige
 * oder teilweise Rückzahlung des entrichteten Entgelts, mindert sich die Bemessungsgrundlage nur, soweit das Entgelt
 * tatsächlich zurückgezahlt wird, und zwar in dem Besteuerungszeitraum, in dem die Rückgewähr erfolgt“. Abs. 8 Satz 5:
 * „Wird die Leistung nach Vereinnahmung des Entgelts rückgängig gemacht, entsteht der Berichtigungsanspruch nach § 17
 * Abs. 2 Nr. 3 UStG erst mit der Rückgewähr des Entgelts (vgl. BFH-Urteil vom 02.09.2010 – V R 34/09, BStBl II 2011
 * S. 991)“. Gehalten wird nur die Überzahlung, höchstens die Minderung der gekennzeichneten Korrekturen. Sie
 * verteilt sich auf die Sätze im Verhältnis dieser Minderung je Satz, in Cent gerundet, der Rest auf den größten Anteil;
 * innerhalb eines Satzes Netto und Steuer im Verhältnis der Korrektur. Eingehendes Geld wird nie abgelehnt
 * (Entscheidung des Maintainers zu #1228).
 * https://www.gesetze-im-internet.de/ustg_1980/__17.html, UStAE Stand 19.10.2026:
 * https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/Umsatzsteuer-Anwendungserlass-aktuell.pdf
 */
function heldUntilRefund(rates: readonly BasisPoints[], s: Stand): TaxShare[] {
  const claims = [...s.claims.values()].filter((claim) => claim.reduce((n, c) => n + gross(c), 0) > 0).flat();
  const over = rates.reduce(
    (n, rate) =>
      n +
      (["base", "tax"] as const).reduce(
        (m, key) => m + sum(s.paid, rate, key) - sum(s.amount, rate, key) + sum(s.writtenOff, rate, key) - sum(claims, rate, key),
        0,
      ),
    0,
  );
  const limits = rates
    .map((rate) => ({ rate, base: -sum(s.flagged, rate, "base"), tax: -sum(s.flagged, rate, "tax") }))
    .filter((l) => gross(l) > 0)
    .sort((a, b) => gross(b) - gross(a));
  const limit = limits.reduce((n, l) => n + gross(l), 0);
  const total = Math.max(0, Math.min(over, limit));
  if (!total) return [];
  const parts = limits.map((l, i) => (i === 0 ? 0 : Math.round((total * gross(l)) / limit)));
  parts[0] = total - parts.reduce((n, p) => n + p, 0);
  return limits.map((l, i) => {
    const tax = Math.round((parts[i]! * l.tax) / gross(l));
    return { rate: l.rate, base: parts[i]! - tax, tax };
  });
}

/**
 * Tagesweiser Steuerstand aus den gespeicherten Belegen und Zahlungen, nicht aus neu gerundeten Prozentsätzen.
 * „plan“: Mindest-Istversteuerung bei Soll, bis zur Leistung nur die Zahlung, danach das gesamte Entgelt samt der bis
 * zur Rückzahlung gehaltenen Steuer (§ 13 Abs. 1 Nr. 1 a UStG). „held“: nur die gehaltene Steuer, als Ergänzung der
 * normalen Soll-Buchungen einer Rechnung ohne Anzahlungsverfahren. Gleiche Tage werden zusammen gerechnet.
 * Quelle: https://www.gesetze-im-internet.de/ustg_1980/__13.html
 */
export function advanceVatSchedule(total: readonly TaxShare[], events: readonly AdvanceVatEvent[], mode: "plan" | "held" = "plan"): AdvanceVatChange[] {
  const byDate = new Map<string, AdvanceVatEvent[]>();
  for (const event of events) byDate.set(event.date, [...(byDate.get(event.date) ?? []), event]);
  const rates = [
    ...new Set(
      [...total, ...events.flatMap((e) => [...(e.paid ?? []), ...(e.writtenOff ?? []), ...(e.correction ?? []), ...(e.legacyClaim?.shares ?? [])])].map(
        (s) => s.rate,
      ),
    ),
  ];
  const s: Stand = { paid: [], writtenOff: [], amount: [...total], flagged: [], claims: new Map(), performed: 0 };
  let previous: TaxShare[] = [];
  const changes: AdvanceVatChange[] = [];
  for (const [date, day] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    for (const e of day) {
      s.paid.push(...(e.paid ?? []));
      s.writtenOff.push(...(e.writtenOff ?? []));
      s.amount.push(...(e.correction ?? []));
      if (e.untilRefund) s.flagged.push(...(e.correction ?? []));
      if (e.legacyClaim) s.claims.set(e.legacyClaim.id, [...(s.claims.get(e.legacyClaim.id) ?? []), ...e.legacyClaim.shares]);
      s.performed += e.performance ?? 0;
    }
    const kept = heldUntilRefund(rates, s);
    const held = (rate: BasisPoints, key: Key) => sum(kept, rate, key);
    const taxable = (rate: BasisPoints, key: Key) => {
      if (mode === "held") return held(rate, key);
      if (s.performed <= 0) return sum(s.paid, rate, key);
      return sum(s.amount, rate, key) - sum(s.writtenOff, rate, key) + held(rate, key);
    };
    const target = rates.map((rate) => ({ rate, base: taxable(rate, "base"), tax: taxable(rate, "tax") }));
    const shares = target
      .map((t) => ({ rate: t.rate, base: t.base - sum(previous, t.rate, "base"), tax: t.tax - sum(previous, t.rate, "tax") }))
      .filter((t) => t.base !== 0 || t.tax !== 0);
    if (shares.length) changes.push({ date, shares });
    previous = target;
  }
  return changes;
}

/** Steuerplan neuer Anzahlungen und Vorauszahlungen (advanceVatSchedule, „plan“). */
export function advanceVatPlan(total: readonly TaxShare[], events: readonly AdvanceVatEvent[]): AdvanceVatChange[] {
  return advanceVatSchedule(total, events);
}
