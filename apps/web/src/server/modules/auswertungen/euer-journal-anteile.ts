import { zahlungsStand, type Kontenrahmen } from "@haben/core";
import { offenerPosten, type Buchung, type Zeile } from "./euer-journal-buchungen.ts";

export const offenerSaldo = (b: Buchung) => b.zeilen.filter((z) => offenerPosten(b.kontenrahmen, z)).reduce((s, z) => s + z.debit - z.credit, 0);

/** Jede Teilzahlung gegen das bereits Erfasste; eine Gegenbuchung hebt genau ihre ursprünglichen Anteile auf. */
export function rechnungsAnteile(kr: Kontenrahmen, zeilen: Zeile[], gesamt: number, ausgleiche: Buchung[]): Map<string, number[]> {
  const anteile = new Map<string, number[]>();
  let ausgeglichen = 0;
  let erfasst = zeilen.map(() => 0);
  for (const a of ausgleiche) {
    const betrag = -offenerSaldo(a);
    const umgekehrt = a.reversesId ? anteile.get(a.reversesId) : undefined;
    const stand = umgekehrt ? null : zahlungsStand(kr, zeilen, gesamt, ausgeglichen + betrag);
    const anteil = umgekehrt ? umgekehrt.map((v) => -v) : stand!.map((v, i) => v - erfasst[i]!);
    erfasst = erfasst.map((v, i) => v + anteil[i]!);
    ausgeglichen += betrag;
    anteile.set(a.id, anteil);
  }
  return anteile;
}
