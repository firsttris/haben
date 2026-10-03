import { formatEuro, saldoAnzeige, saldoSeite, type Kontenrahmen } from "@haben/core";

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const ZEITRAEUME: [string, string][] = [
  ["jahr", "Ganzes Jahr"],
  ["q1", "1. Quartal"],
  ["q2", "2. Quartal"],
  ["q3", "3. Quartal"],
  ["q4", "4. Quartal"],
  ...MONATE.map((m, i): [string, string] => [`m${i + 1}`, m]),
];

/**
 * Saldo eines Kontos in Alltagssprache: Erlöse und Aufwand als positiver Betrag, Bestandskonten
 * mit „Guthaben“ oder „Schuld“. Die Buchhaltungsseite (S/H) steht klein daneben.
 */
export function SaldoBetrag({ kontenrahmen, account, saldo }: { kontenrahmen: Kontenrahmen; account: string; saldo: number }) {
  const { betrag, hinweis } = saldoAnzeige(kontenrahmen, account, saldo);
  const seite = saldoSeite(saldo);
  return (
    <span title={seite ? `${seite === "S" ? "Soll" : "Haben"}-Saldo` : undefined}>
      {formatEuro(betrag)}
      <span className="saldo-hint">
        {hinweis}
        {seite && <span className="side-mark">{seite}</span>}
      </span>
    </span>
  );
}

/** Kurzes Datum ohne Jahr: 30.09. */
export function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}
