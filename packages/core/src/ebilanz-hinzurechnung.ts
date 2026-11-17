import type { Kontenrahmen } from "./posting.ts";

/*
 * Positionen der E-Bilanz für Zinsen, Renten, Miete, Pacht und Leasing, die die Gewerbesteuer hinzurechnet (koerperschaft.ts;
 * Kennzeichen G im DATEV-Kontenrahmen 2026, SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175), statt der Auffangposition: Die
 * Buchführung trennt sie schon (BMF-Schreiben vom 28.09.2011, BStBl I S. 855, Rz. 16 und 19). Kfz-Leasing gehört zum
 * Leasing beweglicher Wirtschaftsgüter, nicht zum Fuhrpark (label-guidance-de der HGB-Taxonomien 6.9 und 6.10: Fuhrpark
 * „ohne Abschreibungen, Zinsen und Leasingkosten“, Leasing beweglich „Inkl. Aufwendungen für Kfz-Leasing“); Mietleasing
 * ist kein Finanzierungsleasing, daher jeweils „übrige“. Renten und dauernde Lasten haben eine eigene Position
 * (`annuities`), Garagenmiete steht bei Miete und Pacht für unbewegliche Wirtschaftsgüter, Zinsen an verbundene Unternehmen
 * bei den übrigen Zinsaufwendungen (`expenses.assoc` ist ein Davon-Vermerk außerhalb der Rechenregeln). Miete unbeweglich
 * (4210/6310) und Kfz-Leasing (4570/6560) stehen bei den Kategorien in ebilanz.ts, die übrigen Zinsen beim Darlehen. Ein
 * Konto, das koerperschaft.ts neu hinzurechnet, braucht hier oder in ebilanz.ts eine Position (ebilanz.test.ts).
 */

const OC = "is.netIncome.regular.operatingTC.otherCost";
const FIN = "is.netIncome.regular.fin.netInterest.expenses";
const ZINSEN = `${FIN}.regularInterest.other`;

const POSITIONEN: Record<Kontenrahmen, readonly [konten: string, position: string][]> = {
  SKR03: [
    ["4575 4810 4965", `${OC}.leasingAll.moveable.other`],
    ["4960 4961 4963", `${OC}.leaseMoveable.other`],
    ["4215", `${OC}.leasingAll.immovable.other`],
    ["4211 4220 4550", `${OC}.leaseFix.other`],
    ["2100 2109 2118 2119 2125 2129", ZINSEN],
    ["2127", `${FIN}.annuities`],
  ],
  SKR04: [
    ["6498 6565 6840", `${OC}.leasingAll.moveable.other`],
    ["6835 6836 6838", `${OC}.leaseMoveable.other`],
    ["6316", `${OC}.leasingAll.immovable.other`],
    ["6315 6317 6550", `${OC}.leaseFix.other`],
    ["7300 7309 7318 7319 7325 7329", ZINSEN],
    ["7327", `${FIN}.annuities`],
  ],
};

/** Konto und Position (bei Soll- wie Haben-Saldo) je Kontenrahmen */
export function hinzurechnungPositionen(kontenrahmen: Kontenrahmen): [konto: string, position: string][] {
  return POSITIONEN[kontenrahmen].flatMap(([konten, position]) => konten.split(" ").map((konto): [string, string] => [konto, position]));
}
