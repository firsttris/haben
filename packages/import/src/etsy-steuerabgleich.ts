import { settlementKey } from "./etsy.ts";

/*
 * Sales Tax im Etsy-Abruf über überlappende Abrufe (etsy-ledger.ts): Welche neue Steuerzeile schon in einem übernommenen
 * Verkauf oder einer übernommenen Erstattung steckt und welche dieser Abruf mit einem neuen Partner verrechnen darf
 * (settleTax). Was nicht genau passt, bleibt eine eigene Zeile; gewählt wird nur, wo die Wahl den Kontostand nicht ändert.
 */

type Partner = "Verkauf" | "Erstattung";

/** Was eine Verlaufszeile für den Abgleich braucht: Art wie in etsy-ledger.ts, Bestellung und Buchungstag */
export interface SteuerZeile<E> {
  entry: E;
  tag: string;
  art: "verkauf" | "erstattung" | "steuer" | undefined;
  amount: number;
  /** Bestellnummer: bei Verkauf und Erstattung aus dem früheren Zweck oder dem Payments-Abruf, bei der Steuer direkt */
  order: string | undefined;
  /** Von einem früheren Abruf übernommen, mit der damals verrechneten Steuer */
  frueher: { verrechnet: number } | undefined;
}

/** Höchstens so viele offene Steuerzeilen je Bestellung und Tag durchsucht `passendeZeilen` (2^n Mengen) */
const MAX_KANDIDATEN = 16;

/**
 * Kleinste Menge der Zeilen mit genau dieser Summe, bei gleicher Größe die mit den früheren Zeilen (die Liste ist nach
 * der Zeit sortiert); keine, wenn es sie nicht gibt.
 */
function passendeZeilen<T extends { amount: number }>(zeilen: T[], summe: number): T[] | undefined {
  if (zeilen.length > MAX_KANDIDATEN) return undefined;
  const suche = (start: number, rest: number, anzahl: number): number[] | undefined => {
    if (anzahl === 0) return rest === 0 ? [] : undefined;
    for (let i = start; i <= zeilen.length - anzahl; i++) {
      const weiter = suche(i + 1, rest - zeilen[i]!.amount, anzahl - 1);
      if (weiter) return [i, ...weiter];
    }
    return undefined;
  };
  for (let anzahl = 1; anzahl <= zeilen.length; anzahl++) {
    const treffer = suche(0, summe, anzahl);
    if (treffer) return treffer.map((i) => zeilen[i]!);
  }
  return undefined;
}

/**
 * `drin`: Steuerzeilen, die schon im Konto stehen. Je Bestellung, Tag und Partnerart (Verkauf bzw. Erstattung) ist das
 * die Summe der damals verrechneten Steuer aller übernommenen Partner; Haben sucht unter den offenen Steuerzeilen die
 * kleinste Menge mit genau dieser Summe, bei gleicher Größe die früheren Zeilen. Welche Zeilen das sind, ändert den
 * Kontostand nicht: Was nicht dazugehört, hat in Summe immer denselben Betrag. Ohne passende Menge zählt keine Zeile.
 *
 * `verrechenbar`: Steuerzeilen mit genau einem möglichen Partner, und der ist neu. Ein übernommener Partner, mit dem noch
 * keine Steuer verrechnet ist, zählt mit: Bei zwei Erstattungen derselben Bestellung am selben Tag bleibt die Steuer so
 * einzeln stehen, statt bei der falschen zu landen.
 */
export function steuerAbgleich<E>(zeilen: SteuerZeile<E>[]): { drin: Set<E>; verrechenbar: Set<E> } {
  const partner = zeilen.flatMap((z) =>
    (z.art === "verkauf" || z.art === "erstattung") && z.order !== undefined
      ? [{ key: settlementKey(z.order, z.tag), partner: (z.art === "verkauf" ? "Verkauf" : "Erstattung") as Partner, frueher: z.frueher }]
      : [],
  );
  const steuern = zeilen.flatMap((z) =>
    z.art === "steuer" && !z.frueher && z.order !== undefined
      ? [{ entry: z.entry, amount: z.amount, key: settlementKey(z.order, z.tag), partner: (z.amount < 0 ? "Verkauf" : "Erstattung") as Partner }]
      : [],
  );

  // Schon verrechnete Steuer je Partnerart, Bestellung und Tag
  const verrechnet = new Map<string, number>();
  for (const p of partner) {
    const gruppe = `${p.partner} ${p.key}`;
    if (p.frueher && p.frueher.verrechnet !== 0) verrechnet.set(gruppe, (verrechnet.get(gruppe) ?? 0) + p.frueher.verrechnet);
  }
  const drin = new Set<E>();
  for (const [gruppe, summe] of verrechnet) {
    const offen = steuern.filter((s) => `${s.partner} ${s.key}` === gruppe);
    for (const s of passendeZeilen(offen, summe) ?? []) drin.add(s.entry);
  }

  const verrechenbar = new Set(
    steuern
      .filter((s) => !drin.has(s.entry))
      .filter((s) => {
        const moeglich = partner.filter((p) => p.key === s.key && p.partner === s.partner && (!p.frueher || p.frueher.verrechnet === 0));
        return moeglich.length === 1 && !moeglich[0]!.frueher;
      })
      .map((s) => s.entry),
  );
  return { drin, verrechenbar };
}
