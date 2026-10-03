import { formatEuro, saldoSeite } from "@haben/core";

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const ZEITRAEUME: [string, string][] = [
  ["jahr", "Ganzes Jahr"],
  ["q1", "1. Quartal"],
  ["q2", "2. Quartal"],
  ["q3", "3. Quartal"],
  ["q4", "4. Quartal"],
  ...MONATE.map((m, i): [string, string] => [`m${i + 1}`, m]),
];

/** Betrag mit Seite: 1.234,00 € S */
export function Saldo({ value }: { value: number }) {
  return (
    <>
      {formatEuro(Math.abs(value))} <span className="small muted">{saldoSeite(value) || " "}</span>
    </>
  );
}
