import type { Cents } from "./money.ts";
import { LOHN_KONTEN } from "./lohn-buchung.ts";
import { isKapitalgesellschaft, ownerLabels, type Rechtsform } from "./rechtsform.ts";
import { ACCOUNTS, ownerAccount, type Kontenrahmen } from "./kontenplan.ts";
import { side, type PostingLine } from "./posting.ts";

/* Buchungen ohne Rechnung oder Beleg: Bankumsätze, Zahlungen über ein privates Konto, Kassenbuchungen. Teil von posting.ts. */

/** Bankumsätze ohne Rechnung oder Beleg */
export const DIRECT_BOOKINGS = {
  privat: "Privat (Entnahme oder Einlage)",
  // Entnahme auf ein eigenes Privatkonto, damit die Summe für die Sonderausgaben (§ 10b EStG) im Journal steht
  spende: "Spende (privat, Sonderausgabe)",
  geldtransit: "Geldtransit (eigenes Konto)",
  ustVorauszahlung: "Umsatzsteuer an das Finanzamt",
  sondervorauszahlung: "Sondervorauszahlung (Dauerfristverlängerung)",
  gebuehren: "Kontoführung und Bankgebühren",
  mahnerloes: "Mahngebühren und Verzugszinsen (vom Kunden)",
  // Bruttozins; einbehaltene Kapitalertragsteuer als eigener Teil einer Aufteilung (Steuerzahlung, steuerzahlung.ts)
  zinsertrag: "Zinserträge (Guthabenzinsen auf ein betriebliches Konto)",
  kapest: "Kapitalertragsteuer an das Finanzamt (Ausschüttung)",
  // Zahlungen aus der Lohnabrechnung, gegen die Verbindlichkeiten ihrer Buchung (lohn-buchung.ts)
  lohn: "Lohn/Gehalt an Mitarbeiter",
  lohnsteuer: "Lohnsteuer an das Finanzamt",
  sozialversicherung: "SV-Beiträge an Krankenkasse oder Minijob-Zentrale",
} as const;

/** Buchungen ohne Beleg, die eine Verbindlichkeit aus der Lohnabrechnung bezahlen; in der EÜR Ausgaben für Personal */
export const LOHN_ZAHLUNGEN = ["lohn", "lohnsteuer", "sozialversicherung"] as const satisfies readonly (keyof typeof DIRECT_BOOKINGS)[];

export type LohnZahlung = (typeof LOHN_ZAHLUNGEN)[number];

export const isLohnZahlung = (kind: string): kind is LohnZahlung => (LOHN_ZAHLUNGEN as readonly string[]).includes(kind);

/** Verbindlichkeit, die eine Lohnzahlung tilgt */
export function lohnZahlungKonto(kind: LohnZahlung, kontenrahmen: Kontenrahmen): string {
  const k = LOHN_KONTEN[kontenrahmen];
  return kind === "lohn" ? k.verbLohn : kind === "lohnsteuer" ? k.verbLohnsteuer : k.verbSv;
}

export type DirectBooking = keyof typeof DIRECT_BOOKINGS;

/** Bezeichnung einer Buchung ohne Beleg; „privat“ heißt in GmbH und UG Gesellschafter-Verrechnungskonto */
export function directBookingLabel(kind: DirectBooking, rechtsform: Rechtsform): string {
  return kind === "privat" ? ownerLabels(rechtsform).bank : DIRECT_BOOKINGS[kind];
}

/**
 * Buchungen ohne Beleg, die es in der Rechtsform gibt: Ausschüttungen und ihre Kapitalertragsteuer nur in GmbH und UG, die
 * private Spende nur ohne GmbH und UG (deren Spenden sind Aufwand mit Abzug nach § 9 Abs. 1 Nr. 2 KStG)
 */
export function directBookingsFor(rechtsform: Rechtsform): DirectBooking[] {
  const gmbh = isKapitalgesellschaft(rechtsform);
  return (Object.keys(DIRECT_BOOKINGS) as DirectBooking[]).filter((kind) => (kind === "kapest" ? gmbh : kind === "spende" ? !gmbh : true));
}

export function directPosting(kind: DirectBooking, amount: Cents, kontenrahmen: Kontenrahmen, rechtsform: Rechtsform): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  if (!directBookingsFor(rechtsform).includes(kind)) {
    throw new Error(`${DIRECT_BOOKINGS[kind]} gibt es ${kind === "spende" ? "nicht in GmbH und UG" : "nur in GmbH und UG"}`);
  }
  const counter = isLohnZahlung(kind)
    ? lohnZahlungKonto(kind, kontenrahmen)
    : kind === "kapest"
      ? accounts.kapestEinbehalt
      : kind === "privat"
        ? ownerAccount(kontenrahmen, rechtsform, amount < 0 ? "entnahme" : "einlage")
        : kind === "spende"
          ? accounts.spenden
          : kind === "geldtransit"
            ? accounts.geldtransit
            : kind === "ustVorauszahlung"
              ? accounts.ustVorauszahlung
              : kind === "sondervorauszahlung"
                ? accounts.sondervorauszahlung
                : kind === "mahnerloes"
                  ? accounts.mahnerloes
                  : kind === "zinsertrag"
                    ? accounts.zinsertraege
                    : accounts.nebenkostenGeldverkehr;
  return [side(accounts.bank, amount, true, null), side(counter, amount, false, null)].filter((line) => line.debit !== 0 || line.credit !== 0);
}

/**
 * Gegenkonto einer Zahlung, die über ein privates Konto läuft (#866): Ein Eingang fließt ins Private (Entnahme,
 * § 4 Abs. 1 Satz 2 EStG), ein Ausgang hat eine betriebliche Schuld aus privatem Geld bezahlt (Einlage). In GmbH
 * und UG steht dort in beiden Richtungen das Gesellschafter-Verrechnungskonto.
 */
export function privatZahlung(amount: Cents, kontenrahmen: Kontenrahmen, rechtsform: Rechtsform): string {
  return ownerAccount(kontenrahmen, rechtsform, amount > 0 ? "entnahme" : "einlage");
}

/**
 * Zahlung über ein privates Konto (#866, #873): Die Zeilen einer Buchung, die gegen die Bank gehen, werden auf das
 * Konto gestellt, über das das Geld tatsächlich lief — bei einem Eingang die Privatentnahme, bei einem Ausgang die
 * Privateinlage (privatZahlung), in GmbH und UG das Gesellschafter-Verrechnungskonto. Die Regel gilt so für jede
 * Buchungsart, und der Aufrufer wendet sie einmal an, statt sie in jedem Zweig zu wiederholen. Auf einem
 * Geschäftskonto entfällt der Aufruf; dort bleibt es bei 1200 bzw. 1800, bei einem Zahlungsdienstleister bei dessen
 * Verrechnungskonto.
 */
export function privatKontoPosting(lines: PostingLine[], amount: Cents, kontenrahmen: Kontenrahmen, rechtsform: Rechtsform): PostingLine[] {
  const bank = ACCOUNTS[kontenrahmen].bank;
  const konto = privatZahlung(amount, kontenrahmen, rechtsform);
  return lines.map((line) => (line.account === bank ? { ...line, account: konto } : line));
}

/** Kassenbuchungen ohne Beleg: Einlage und Entnahme, Geld von der Bank in die Kasse und zurück */
export const CASH_BOOKINGS = {
  einlage: { label: "Einlage", sign: 1, kind: "privat" },
  entnahme: { label: "Entnahme", sign: -1, kind: "privat" },
  abhebung: { label: "Abhebung von der Bank", sign: 1, kind: "geldtransit" },
  einzahlung: { label: "Einzahlung auf die Bank", sign: -1, kind: "geldtransit" },
} as const;

export type CashBooking = keyof typeof CASH_BOOKINGS;

/** Bezeichnung einer Kassenbuchung; Einlage und Entnahme heißen in GmbH und UG „Vom“ bzw. „An den Gesellschafter“ */
export function cashBookingLabel(kind: CashBooking, rechtsform: Rechtsform): string {
  const owner = ownerLabels(rechtsform);
  return kind === "einlage" ? owner.cashIn : kind === "entnahme" ? owner.cashOut : CASH_BOOKINGS[kind].label;
}

/** Art einer Zeile im Kassenbuch: bar bezahlter Beleg, Bareinnahme auf eine oder ohne Rechnung oder eine Kassenbuchung ohne Beleg */
export function cashEntryLabel(kind: CashBooking | "beleg" | "rechnung" | "einnahme" | "import", rechtsform: Rechtsform): string {
  if (kind === "import") return "Übernommene Kassenbewegung";
  if (kind === "beleg") return "Beleg";
  if (kind === "rechnung") return "Bareinnahme Rechnung";
  return kind === "einnahme" ? "Bareinnahme" : cashBookingLabel(kind, rechtsform);
}

/** Kasse an Privateinlage (bzw. Gesellschafter) oder Geldtransit; Ausgänge aus der Kasse (negativ) drehen die Seiten */
export function cashPosting(kind: "privat" | "geldtransit", amount: Cents, kontenrahmen: Kontenrahmen, rechtsform: Rechtsform): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const counter = kind === "geldtransit" ? accounts.geldtransit : ownerAccount(kontenrahmen, rechtsform, amount < 0 ? "entnahme" : "einlage");
  return [side(accounts.kasse, amount, true, null), side(counter, amount, false, null)].filter((line) => line.debit !== 0 || line.credit !== 0);
}
