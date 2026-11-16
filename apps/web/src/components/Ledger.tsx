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
export const JOURNAL_SOURCE = {
  // Eigene Buchung neben dem Beleg, wenn dessen Leistung beim Buchen noch nicht ausgeführt war (#693)
  freigabe: "Vorsteuerfreigabe",
  invoice: "Rechnung",
  document: "Beleg",
  allocation: "Bank",
  asset: "Anlage",
  pauschale: "Pauschale",
  kasse: "Kasse",
  ausbuchung: "Ausbuchung",
  manuell: "Manuell",
  eroeffnung: "Eröffnung",
  ausschuettung: "Ausschüttung",
  lohn: "Lohn",
  import: "Import",
  verrechnung: "Verrechnung",
} as const;
export type JournalSource = keyof typeof JOURNAL_SOURCE;

/** Detailseite des Vorgangs hinter einer Buchung */
export type Vorgang = { to: "/rechnungen/$id" | "/belege/$id" | "/anlagen/$id"; id: string };

/**
 * Vorgang zur Herkunft einer Buchung, wenn er eine eigene Detailseite hat (Journal und Kontenblatt); sonst null, dann
 * führt die Seite auf die Übersicht (Bank, Kasse, Lohn, …) oder zeigt nur die Herkunft.
 */
export function vorgangZurHerkunft(e: { sourceType: string; sourceId: string; invoiceId: string | null; documentId: string | null }): Vorgang | null {
  if (e.sourceType === "invoice") return { to: "/rechnungen/$id", id: e.sourceId };
  // Freigabe der Vorsteuer zum Leistungsdatum (#693): Quelle ist der Beleg selbst (vorsteuer-freigabe.ts)
  if (e.sourceType === "document" || e.sourceType === "freigabe") return { to: "/belege/$id", id: e.sourceId };
  // Verrechnung mit einer Kundenkorrektur (#877) bzw. zweier Belege (#786): auf den Vorgang, nicht auf die Bank
  if (e.sourceType === "verrechnung" && e.invoiceId) return { to: "/rechnungen/$id", id: e.invoiceId };
  if (e.sourceType === "verrechnung" && e.documentId) return { to: "/belege/$id", id: e.documentId };
  if (e.sourceType === "asset") return { to: "/anlagen/$id", id: e.sourceId };
  return null;
}

/** Herkünfte, die es nur in einer Rechtsform gibt: Pauschalen im Einzelunternehmen, die übrigen in GmbH und UG (docs/einrichtung.md) */
const NUR_EINZELUNTERNEHMEN: readonly JournalSource[] = ["pauschale"];
const NUR_KAPITALGESELLSCHAFT: readonly JournalSource[] = ["manuell", "eroeffnung", "ausschuettung"];

/** Herkünfte für den Filter: ohne die der anderen Rechtsform, außer es gibt doch Buchungen damit */
export function journalSourcesFor(gesellschaft: boolean, counts: Readonly<Record<string, number>>): JournalSource[] {
  const fremd = gesellschaft ? NUR_EINZELUNTERNEHMEN : NUR_KAPITALGESELLSCHAFT;
  return (Object.keys(JOURNAL_SOURCE) as JournalSource[]).filter((s) => !fremd.includes(s) || (counts[s] ?? 0) > 0);
}

/** Letzter Tag vor einem ausschließlichen Enddatum (YYYY-MM-DD) */
export function lastDayBefore(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** Kurzes Datum ohne Jahr: 30.09. */
export function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}
