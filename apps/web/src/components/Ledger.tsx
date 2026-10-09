import { MONTHS, formatEuro, saldoAnzeige, saldoSeite, type Kontenrahmen } from "@haben/core";

export const ZEITRAEUME: [string, string][] = [
  ["jahr", "Ganzes Jahr"],
  ["q1", "1. Quartal"],
  ["q2", "2. Quartal"],
  ["q3", "3. Quartal"],
  ["q4", "4. Quartal"],
  ...MONTHS.map((m, i): [string, string] => [`m${i + 1}`, m]),
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

/** Herkunft einer Journalbuchung */
export const JOURNAL_SOURCE = { invoice: "Rechnung", document: "Beleg", allocation: "Bank", asset: "Anlage", pauschale: "Pauschale", kasse: "Kasse" } as const;
export type JournalSource = keyof typeof JOURNAL_SOURCE;

/** Letzter Tag vor einem ausschließlichen Enddatum (YYYY-MM-DD) */
export function lastDayBefore(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** Kurzes Datum ohne Jahr: 30.09. */
export function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}
