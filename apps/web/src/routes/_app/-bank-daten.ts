import { AUFLADUNG, type DirectBooking, type OffeneKorrektur, zahlungMitKorrektur, type ZahlungMitKorrektur } from "@haben/core";
import { aufladungWahl, type KategorieWahl } from "../../components/KategorieFelder.tsx";
import type { getBankOverview } from "../../server/functions/bank.ts";
import { today as todayInGermany } from "../../server/today.ts";
import type { AufzuhebendeZuordnung } from "../../components/ZuordnungAufheben.tsx";

export type Data = Awaited<ReturnType<typeof getBankOverview>>;

export type Detail = NonNullable<Data["detail"]>;

export type Allocation = Detail["allocations"][number];

export const KIND_LABEL = {
  invoice: "Rechnung",
  document: "Beleg",
  privat: "Privat",
  spende: "Spende",
  geldtransit: "Geldtransit",
  ustVorauszahlung: "Umsatzsteuer",
  sondervorauszahlung: "Sondervorauszahlung",
  gebuehren: "Bankgebühren",
  mahnerloes: "Mahngebühren und Zinsen",
  kursdifferenz: "Kursdifferenz",
  kapest: "Kapitalertragsteuer",
  lohn: "Lohn/Gehalt",
  lohnsteuer: "Lohnsteuer",
  sozialversicherung: "SV-Beiträge",
  steuer: "Steuer",
  zinsertrag: "Zinserträge",
  darlehen: "Darlehen",
  kategorie: "Direkt",
  aufladung: AUFLADUNG.text,
} as const;

/**
 * Hinweis zu „Direkt buchen“ (früher „Ohne Rechnung buchen“, #312): Unterlagen sind nicht nur Rechnungen, sondern auch
 * Steuerbescheide, Kreditverträge oder Abrechnungen; den Zahlungsnachweis bildet der Bankumsatz selbst.
 */
export const DIRECT_HINT = "Bankumsatz einer Buchungsart zuordnen, ohne einen separaten Beleg anzulegen.";

/** Wie die Zuordnung in der Liste und in der Rückfrage heißt */
export function zuordnungText(a: Allocation, gesellschaft: boolean): string {
  return [
    a.kind === "privat" && gesellschaft ? "Gesellschafter" : KIND_LABEL[a.kind],
    a.invoiceNumber ? ` ${a.invoiceNumber}` : "",
    a.documentSupplier ? ` ${a.documentSupplier}${a.documentNumber ? ` (${a.documentNumber})` : ""}` : "",
    a.vatReturnLabel ? ` ${a.vatReturnLabel}` : "",
    a.steuerLabel ? `: ${a.steuerLabel}` : "",
    a.darlehenLabel ? `: ${a.darlehenLabel}` : "",
    a.kategorieLabel ? `: ${a.kategorieLabel}` : "",
  ].join("");
}

/** Bei einer Aufteilung hebt der Server alle Teile auf, also nennt die Rückfrage auch alle */
export function zuAufhebendeZuordnung(
  a: Allocation,
  allocations: Allocation[],
  gesellschaft: boolean,
  tag: string,
  gemeldeteMonate: readonly string[],
): AufzuhebendeZuordnung {
  const teile = a.splitId ? allocations.filter((other) => other.splitId === a.splitId && !other.reversed) : [a];
  const heute = todayInGermany();
  return {
    id: a.id,
    bezeichnung: a.splitId ? `Aufteilung in ${teile.length} Teile` : zuordnungText(a, gesellschaft),
    betrag: teile.reduce((summe, teil) => summe + teil.amount, 0),
    aufteilung: a.splitId !== null,
    mitBeleg: teile.some((teil) => teil.kind === "invoice" || teil.kind === "document"),
    // Die Zuordnung steht am Buchungsdatum ihres Umsatzes; früher kann die Aufhebung nicht wirken (#782). Liegt die
    // Zahlung selbst in der Zukunft, ist heute der früheste Tag — dieselbe Grenze prüft der Server.
    tag: tag <= heute ? tag : heute,
    // Ist der Zeitraum der Zahlung gemeldet, wirkt die Aufhebung heute; sonst gehört die Korrektur dorthin (#782)
    gemeldet: gemeldeteMonate.includes(tag.slice(0, 7)),
  };
}

/** „Direkt buchen“: Buchungsarten ohne Beleg, Kategorie mit Steuersatz, Steuerzahlung mit Steuerart, Bezugsjahr und Teil, Darlehen */
export type DirectChoice = DirectBooking | "kategorie" | "aufladung" | "steuer" | "darlehen";

/**
 * Nutzlast einer Direktbuchung auf eine Kategorie: Die Aufladung trägt dieselben Felder, aber nie einen Steuersatz
 * (#1356). Dialog und Buchung lesen beide `aufladungWahl`, damit Anzeige und Buchung nicht auseinanderlaufen.
 */
export function direktKategorie(kind: "kategorie" | "aufladung", transactionId: string, amount: number, kategorie: KategorieWahl) {
  return kind === "aufladung"
    ? { kind: "aufladung" as const, transactionId, amount, kategorie: aufladungWahl(kategorie) }
    : { kind: "kategorie" as const, transactionId, amount, kategorie };
}

export const KATEGORIE_OPTION = { value: "kategorie", label: "Einnahme oder Ausgabe (Kategorie, Steuersatz)" } as const;

export const STEUER_OPTION = { value: "steuer", label: "Steuerzahlung oder Erstattung (Finanzamt, Gemeinde)" } as const;

export const DARLEHEN_OPTION = { value: "darlehen", label: "Darlehen: Auszahlung, Tilgung, Zinsen oder Gebühren" } as const;

/** Offener Posten in Auswahl und Treffer: Rechnung, Beleg oder Zahllast bzw. Erstattung einer Voranmeldung */
export function itemLabel(item: { type: "invoice" | "document" | "ustva"; number: string; partyName: string }): string {
  if (item.type === "invoice") return `Rechnung ${item.number}`;
  if (item.type === "ustva") return `Voranmeldung ${item.number}`;
  return `Beleg ${item.partyName} ${item.number}`;
}

/** Ziel einer Zuordnung aus „Typ:ID“ der Auswahl */
export function itemTarget(type: string | undefined, id: string, amount: number) {
  if (type === "invoice") return { kind: "invoice" as const, invoiceId: id, amount };
  if (type === "ustva") return { kind: "ustva" as const, vatReturnId: id, amount };
  return { kind: "document" as const, documentId: id, amount };
}

/** Posten, dem ein Umsatz gerade zugeordnet würde: bester Treffer oder gewählte Rechnung, Beleg, Voranmeldung */
export type Posten = Detail["suggestions"][number]["item"] | Detail["candidates"][number];

export type RestArt = "skonto" | "forderungsausfall" | "skontoErhalten";

/** Offene Korrektur einer Rechnung, wie der Abgleich sie mitliefert */
export type Korrektur = OffeneKorrektur;

/**
 * Offene Korrekturen zur Rechnung, die den Rest einer Zahlung ausgleichen, auch mit Skonto auf den geminderten Betrag:
 * Der Kunde hat „Rechnung minus Korrektur“ gezahlt (zahlungMitKorrektur)
 */
export function passendeKorrektur(target: Posten | undefined, tx: Detail["transaction"]): ZahlungMitKorrektur | undefined {
  return target ? zahlungMitKorrektur({ amount: tx.open, bookingDate: tx.bookingDate }, target) : undefined;
}

/** „Korrektur 2026-004“ bzw. „Korrekturen 2026-004, 2026-005“ */
export function korrekturText(korrekturen: readonly Korrektur[]): string {
  return `${korrekturen.length === 1 ? "Korrektur" : "Korrekturen"} ${korrekturen.map((k) => k.number).join(", ")}`;
}

/** Was nach der Zuordnung an einen Posten übrig bliebe und wie es sich ausbuchen lässt */
export function restAngebot(target: Posten | undefined, tx: Detail["transaction"]) {
  // Gleichen offene Korrekturen den Rest aus, ist er weder Gebühr noch Skonto noch Forderungsausfall (#1398): Die
  // Korrektur hat das Entgelt schon gemindert (§ 17 Abs. 1 UStG); eine Ausbuchung minderte Erlös und Umsatzsteuer doppelt.
  // Bleibt nach den Korrekturen genau ein Skonto, ist nur dieses Skonto (auf den geminderten Betrag) auszubuchen.
  const korrektur = passendeKorrektur(target, tx);
  // Nur bei Zahlungseingängen: der Dienstleister behält eine Gebühr ein. Zahlst du selbst weniger, ist das Skonto, keine Gebühr.
  const feeRest = target && !korrektur && target.type !== "ustva" && tx.amount > 0 && target.open > tx.open ? tx.open - target.open : 0;
  // Zahlung unter dem offenen Betrag: Rest ausbuchen (Skonto, Forderungsausfall) statt als Teilzahlung stehen lassen
  const rest = target && Math.sign(target.open) === Math.sign(tx.open) && Math.abs(target.open) > Math.abs(tx.open) ? target.open - tx.open : 0;
  const restKinds: RestArt[] =
    rest === 0 || korrektur
      ? []
      : target?.type === "invoice" && tx.amount > 0
        ? ["skonto", "forderungsausfall"]
        : target?.type === "document" && tx.amount < 0
          ? ["skontoErhalten"]
          : [];
  // Rechnung oder Beleg in Fremdwährung: Abweichung der Zahlung vom umgerechneten Betrag als Kursdifferenz (Zahlung − offen)
  const exchangeDifference =
    !korrektur && target?.currency && target.currency !== "EUR" && Math.sign(target.open) === Math.sign(tx.open) && target.open !== tx.open
      ? tx.open - target.open
      : 0;
  return { feeRest, rest, restKinds, exchangeDifference, korrektur };
}
