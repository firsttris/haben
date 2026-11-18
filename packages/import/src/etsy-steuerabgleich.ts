import { settlementKey } from "./etsy.ts";

/*
 * Sales Tax im Etsy-Abruf über überlappende Abrufe (etsy-ledger.ts): Welche neue Steuerzeile schon in einem übernommenen
 * Verkauf oder einer übernommenen Erstattung steckt und welche dieser Abruf mit einem neuen Partner verrechnen darf
 * (settleTax). Geraten wird nicht: Was nicht genau passt, bleibt eine eigene Zeile.
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

/**
 * `drin`: Steuerzeilen, die schon im Konto stehen. Je übernommenem Partner zuerst eine Zeile mit genau der damals
 * verrechneten Steuer, sonst alle offenen Steuerzeilen derselben Bestellung und desselben Tages für einen Verkauf bzw.
 * eine Erstattung zusammen, wenn ihre Summe genau passt.
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

  const drin = new Set<E>();
  const pool = partner.flatMap((p) => (p.frueher && p.frueher.verrechnet !== 0 ? [{ ...p, rest: p.frueher.verrechnet }] : []));
  for (const p of pool) {
    const treffer = steuern.find((s) => !drin.has(s.entry) && s.key === p.key && s.partner === p.partner && s.amount === p.rest);
    if (treffer) {
      drin.add(treffer.entry);
      p.rest = 0;
    }
  }
  for (const p of pool.filter((x) => x.rest !== 0)) {
    const offen = steuern.filter((s) => !drin.has(s.entry) && s.key === p.key && s.partner === p.partner);
    if (offen.length > 1 && offen.reduce((summe, s) => summe + s.amount, 0) === p.rest) for (const s of offen) drin.add(s.entry);
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
