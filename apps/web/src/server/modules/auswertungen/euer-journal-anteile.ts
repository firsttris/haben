import { zahlungsStand, type Kontenrahmen } from "@haben/core";
import { offenerPosten, type Buchung, type Verrechnung, type Zeile } from "./euer-journal-buchungen.ts";

export const offenerSaldo = (b: Buchung) => b.zeilen.filter((z) => offenerPosten(b.kontenrahmen, z)).reduce((s, z) => s + z.debit - z.credit, 0);

/**
 * Zeilen und offener Posten einer Rechnung nach ihren Verrechnungen: Eine Verrechnung nimmt das Entgelt der Gegenrechnung
 * weg, also deren Anteil an den Zeilen; über den Rest verteilen sich die Zahlungen. Ohne diesen Schritt teilt die EÜR eine
 * Zahlung über die volle Rechnung, während die Voranmeldung sie über den Rest teilt (#877, Befund 3).
 */
export function restNachVerrechnungen(zeilen: Zeile[], gesamt: number, verrechnungen: readonly Verrechnung[]): { zeilen: Zeile[]; gesamt: number } {
  if (verrechnungen.length === 0 || gesamt === 0) return { zeilen, gesamt };
  const saldo = zeilen.map((z) => z.debit - z.credit);
  const jeZeile = new Map(zeilen.map((z, i) => [`${z.account}|${z.taxCode ?? ""}`, i]));
  // Falls die Gegenrechnung ein anderes Erlöskonto führt: je Steuerschlüssel die Zeile mit dem größten Betrag
  const jeSatz = new Map<string, number>();
  zeilen.forEach((z, i) => {
    const satz = z.taxCode ?? "";
    const alt = jeSatz.get(satz);
    if (alt === undefined || Math.abs(saldo[i]!) > Math.abs(saldo[alt]!)) jeSatz.set(satz, i);
  });
  let abgezogen = 0;
  for (const v of verrechnungen) {
    if (v.gesamt === 0 || v.betrag === 0) continue;
    // Der Anteil der Gegenrechnung an ihren eigenen Zeilen, ausgeglichen so weit wie ihr offener Posten reicht
    const anteil = zahlungsStand(v.kontenrahmen, v.zeilen, v.gesamt, Math.sign(v.gesamt) * v.betrag);
    anteil.forEach((a, i) => {
      if (a === 0) return;
      const quelle = v.zeilen[i]!;
      const ziel = jeZeile.get(`${quelle.account}|${quelle.taxCode ?? ""}`) ?? jeSatz.get(quelle.taxCode ?? "");
      if (ziel === undefined) return;
      saldo[ziel] = saldo[ziel]! + a;
      abgezogen += a;
    });
  }
  if (abgezogen === 0) return { zeilen, gesamt };
  return {
    zeilen: zeilen.map((z, i) => ({ ...z, debit: Math.max(saldo[i]!, 0), credit: saldo[i]! < 0 ? -saldo[i]! : 0 })),
    gesamt: gesamt - abgezogen,
  };
}

/**
 * Jede Teilzahlung gegen das bereits Erfasste; eine Gegenbuchung hebt genau ihre ursprünglichen Anteile auf. Verrechnungen
 * wirken wie eine Zahlung ohne Geld: Sie nehmen das Entgelt der Gegenrechnung aus dem Mix, und zwar an ihrer Stelle in der
 * Reihenfolge der Buchungen — eine Zahlung davor verteilt sich über die volle Rechnung, eine danach über den Rest (#877).
 */
export function rechnungsAnteile(
  kr: Kontenrahmen,
  zeilen: Zeile[],
  gesamt: number,
  ausgleiche: Buchung[],
  verrechnungen: readonly Verrechnung[] = [],
): Map<string, number[]> {
  const anteile = new Map<string, number[]>();
  type Ereignis = { position: number; zahlung?: Buchung; verrechnung?: Verrechnung };
  const ereignisse: Ereignis[] = [
    ...ausgleiche.map((b) => ({ position: b.position ?? Number.MAX_SAFE_INTEGER, zahlung: b })),
    ...verrechnungen.map((v) => ({ position: v.position, verrechnung: v })),
  ].sort((a, b) => a.position - b.position);
  let rahmen = { zeilen, gesamt };
  let aktiv: Verrechnung[] = [];
  let ausgeglichen = 0;
  let erfasst = zeilen.map(() => 0);
  for (const e of ereignisse) {
    if (e.verrechnung) {
      const v = e.verrechnung;
      // Eine Aufhebung gibt das Entgelt ab ihrer Stelle zurück; Zahlungen davor bleiben beim damaligen Rest
      aktiv = v.hebtAuf ? aktiv.filter((a) => a.id !== v.hebtAuf) : [...aktiv, v];
      rahmen = restNachVerrechnungen(zeilen, gesamt, aktiv);
      continue;
    }
    const b = e.zahlung!;
    const betrag = -offenerSaldo(b);
    const umgekehrt = b.reversesId ? anteile.get(b.reversesId) : undefined;
    const stand = umgekehrt ? null : zahlungsStand(kr, rahmen.zeilen, rahmen.gesamt, ausgeglichen + betrag);
    const anteil = umgekehrt ? umgekehrt.map((v) => -v) : stand!.map((v, i) => v - erfasst[i]!);
    erfasst = erfasst.map((v, i) => v + anteil[i]!);
    ausgeglichen += betrag;
    anteile.set(b.id, anteil);
  }
  return anteile;
}
