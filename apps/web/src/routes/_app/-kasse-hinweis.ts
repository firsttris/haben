import { type CashBooking, isKapitalgesellschaft, type Rechtsform } from "@haben/core";

/** Kassenbuchung ohne Beleg, Bareinnahme auf eine Rechnung oder ohne Rechnung */
export type Mode = CashBooking | "rechnung" | "einnahme";

/** Was eine Buchung der gewählten Art bucht und wofür sie gedacht ist (Formular in kasse.tsx) */
export function kindHint(kind: Mode, rechtsform: Rechtsform): string {
  if (kind === "einnahme")
    return "Für Verkäufe an Privatkunden ohne Rechnung, auch als Tagessumme. Gebucht am Tag der Bareinnahme: Kasse an Erlöse, die Umsatzsteuer ist im selben Monat fällig, bei Ist- wie bei Soll-Versteuerung.";
  if (kind === "rechnung")
    return "Gebucht wie eine Zahlung im Bankabgleich, nur Kasse an Forderungen; bei Ist-Versteuerung wird die Umsatzsteuer mit der Bareinnahme fällig. Ein Rest bleibt offen oder wird als Skonto ausgebucht; gibt der Kunde mehr, etwa Trinkgeld, wird der Teil darüber eine weitere Einnahme.";
  if (kind === "abhebung" || kind === "einzahlung")
    return "Gebucht über Geldtransit. Den Umsatz auf dem Bankkonto ordnest du im Bankabgleich als „Geldtransit“ zu.";
  if (isKapitalgesellschaft(rechtsform))
    return "Gebucht über das Gesellschafter-Verrechnungskonto, z. B. Wechselgeld vom Gesellschafter oder eine Barauszahlung an ihn.";
  return kind === "einlage"
    ? "Privates Geld in die Kasse, z. B. als Wechselgeld oder um eine Barausgabe zu bezahlen."
    : "Geld aus der Kasse für private Zwecke.";
}
