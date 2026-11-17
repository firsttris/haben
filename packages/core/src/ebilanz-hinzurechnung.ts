import type { Kontenrahmen } from "./posting.ts";

/*
 * Positionen der E-Bilanz für Miete, Pacht, Leasing und Zinsen, die die Gewerbesteuer hinzurechnet (koerperschaft.ts;
 * Kennzeichen G im DATEV-Kontenrahmen 2026, SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175), statt der Auffangposition: Die
 * Buchführung trennt sie schon (BMF-Schreiben vom 28.09.2011, BStBl I S. 855, Rz. 16 und 19). Kfz-Leasing gehört zum
 * Leasing beweglicher Wirtschaftsgüter, nicht zum Fuhrpark (label-guidance-de der HGB-Taxonomien 6.9 und 6.10: Fuhrpark
 * „ohne Abschreibungen, Zinsen und Leasingkosten“, Leasing beweglich „Inkl. Aufwendungen für Kfz-Leasing“); Mietleasing
 * ist kein Finanzierungsleasing, daher jeweils „übrige“. Miete unbeweglich (4210/6310) und Kfz-Leasing (4570/6560) stehen
 * bei den Kategorien in ebilanz.ts, die übrigen Zinsen beim Darlehen. Ein Konto, das koerperschaft.ts neu hinzurechnet,
 * braucht hier oder in ebilanz.ts eine Position (ebilanz.test.ts).
 */

const OC = "is.netIncome.regular.operatingTC.otherCost";
const ZINSEN = "is.netIncome.regular.fin.netInterest.expenses.regularInterest.other";

const POSITIONEN: Record<Kontenrahmen, readonly [konten: string, position: string][]> = {
  SKR03: [
    ["4575 4965", `${OC}.leasingAll.moveable.other`],
    ["4960 4961 4963", `${OC}.leaseMoveable.other`],
    ["4215", `${OC}.leasingAll.immovable.other`],
    ["4211 4220", `${OC}.leaseFix.other`],
    ["2100", ZINSEN],
  ],
  SKR04: [
    ["6565", `${OC}.leasingAll.moveable.other`],
    ["6835 6836 6838", `${OC}.leaseMoveable.other`],
    ["6316", `${OC}.leasingAll.immovable.other`],
    ["6315 6317", `${OC}.leaseFix.other`],
    ["7300", ZINSEN],
  ],
};

/** Konto und Position (bei Soll- wie Haben-Saldo) je Kontenrahmen */
export function hinzurechnungPositionen(kontenrahmen: Kontenrahmen): [konto: string, position: string][] {
  return POSITIONEN[kontenrahmen].flatMap(([konten, position]) => konten.split(" ").map((konto): [string, string] => [konto, position]));
}
