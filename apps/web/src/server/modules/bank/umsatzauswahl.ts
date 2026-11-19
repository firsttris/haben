import {
  aufKontoAngeboten,
  directBookingLabel,
  kategorieText,
  type AccountPurpose,
  type DirectSuggestion,
  type Suggestion,
  suggestDirectBooking,
  suggestLohnsteuer,
  suggestMatches,
} from "@haben/core";
import { lstaZahlbetraege } from "../lohn/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { ownAccounts } from "./accounts.ts";
import type { AllocationInput } from "./allocation.ts";
import { learnedDirectSuggestions } from "./learned-suggestions.ts";
import { openItems } from "./offene-posten.ts";
import { listTransactions, UMSATZ_LISTENLIMIT } from "./transaction-list.ts";
import { nachStatusSortieren, type UmsatzSortierung } from "./umsatzliste.ts";

type Umsatz = Awaited<ReturnType<typeof listTransactions>>[number];

type Konto = { id: string; purpose: AccountPurpose };

/** Buchungsarten, die sich ohne weitere Angaben bestätigen lassen; Geldtransit braucht die Gegenbuchung, Aufladung eine Kategorie, Steuerzahlungen den Zeitraum der Anmeldung */
const EINFACHE_ARTEN = ["privat", "spende", "gebuehren", "mahnerloes", "zinsertrag"] as const;

/** Was „Bestätigen“ bucht (#1440): genau der Vorschlag, den die Liste zeigt; null, wenn er sich nicht ohne Rückfrage buchen lässt */
export type Bestaetigung = { input: AllocationInput; text: string };

function bestaetigungFuer(
  row: { id: string; open: number },
  match: Suggestion | undefined,
  direkt: DirectSuggestion | null,
  gelernt: DirectSuggestion | undefined,
  rechtsform: Parameters<typeof directBookingLabel>[1],
  zahlungsdienstleister: boolean,
): Bestaetigung | null {
  const transactionId = row.id;
  const amount = row.open;
  if (match) {
    // Nur der volle Betrag ohne Skonto oder Kursdifferenz; alles andere entscheidet der Mensch in der Detailansicht.
    // Beim Zahlungsdienstleister kann zur Zahlung eine Gebühr gehören, die erst die Detailansicht mitbucht („Zuordnen und Gebühr buchen“)
    if (match.amount !== amount || match.skonto || match.exchangeDifference || (zahlungsdienstleister && amount > 0)) return null;
    if (match.item.type === "invoice")
      return { input: { kind: "invoice", transactionId, invoiceId: match.item.id, amount }, text: `Rechnung ${match.item.number}` };
    if (match.item.type === "document")
      return { input: { kind: "document", transactionId, documentId: match.item.id, amount }, text: `Beleg ${match.item.number}` };
    return null;
  }
  // Wie in der Detailansicht: eine Regel der Kontozwecke gilt vor dem Gelernten (transaction-detail.ts); ist sie nicht bestätigbar, bleibt es beim Einzelbuchen
  const art = direkt ?? gelernt;
  if (!art || art.requiresCounterpart) return null;
  if (art.kind === "kategorie") {
    return art.kategorie ? { input: { kind: "kategorie", transactionId, amount, kategorie: art.kategorie }, text: kategorieText(art.kategorie) } : null;
  }
  const kind = EINFACHE_ARTEN.find((k) => k === art.kind);
  if (!kind) return null;
  return { input: { kind, transactionId, amount }, text: directBookingLabel(kind, rechtsform) };
}

/** Hinweis je Umsatz; Vorschläge für direkte Buchungen hängen am Konto des Umsatzes, auch in „Alle Konten“ */
export async function mitHinweisen(
  umsatze: Umsatz[],
  items: Awaited<ReturnType<typeof openItems>>,
  own: Awaited<ReturnType<typeof ownAccounts>>,
  konten: readonly Konto[],
) {
  const lohnsteuer = await lstaZahlbetraege();
  const learned = await learnedDirectSuggestions(umsatze.filter((row) => !row.duplicatePending && row.open !== 0 && row.open === row.amount));
  const { rechtsform } = await loadCompany();
  return umsatze.map((row) => {
    if (row.duplicateConfirmed) return { ...row, suggestion: null, bestaetigung: null, hint: "bestaetigteDublette" as const };
    if (row.duplicatePending) return { ...row, suggestion: null, bestaetigung: null, hint: "dublette" as const };
    if (row.neutralized) return { ...row, suggestion: null, bestaetigung: null, hint: "verrechnet" as const };
    // Gekennzeichnete Umsätze auf privaten Konten sind erledigt, ohne gebucht zu sein (#1088): nicht „Offen"
    if (row.privat) return { ...row, suggestion: null, bestaetigung: null, hint: "privat" as const };
    if (row.open === 0) return { ...row, suggestion: null, bestaetigung: null, hint: "zugeordnet" as const };
    const current = own.find((account) => account.id === row.bankAccountId);
    const purpose = konten.find((konto) => konto.id === row.bankAccountId)?.purpose ?? "geschaeft";
    const [match] = suggestMatches({ ...row, amount: row.open }, items, 1);
    // PayPal auf dem Bankkonto braucht die Gegenbuchung, die erst die Detailansicht sucht.
    let direct = !match && row.open === row.amount && current ? suggestDirectBooking(row, current, own) : null;
    // Wie die Detailansicht: Lastschrift des Finanzamts über den Betrag einer Lohnsteuer-Anmeldung, vor dem Gelernten
    if (!match && !direct && row.open === row.amount) direct = suggestLohnsteuer(row, lohnsteuer);
    // Was auf diesem Konto nicht buchbar ist, wird nicht vorgeschlagen (#873)
    if (direct && !aufKontoAngeboten(direct.kind, purpose)) direct = null;
    // Gelernte Buchungsarten müssen auf diesem Konto zulässig sein (#873).
    const previous = learned.get(row.id);
    const hasSuggestion = !!match || (direct !== null && !direct.requiresCounterpart) || (previous !== undefined && aufKontoAngeboten(previous.kind, purpose));
    const gelerntErlaubt = previous !== undefined && aufKontoAngeboten(previous.kind, purpose) ? previous : undefined;
    const bestaetigung = hasSuggestion ? bestaetigungFuer(row, match, direct, gelerntErlaubt, rechtsform, purpose === "zahlungsdienstleister") : null;
    return {
      ...row,
      bestaetigung,
      suggestion: match ? { type: match.item.type, number: match.item.number, partyName: match.item.partyName } : null,
      hint: hasSuggestion
        ? ("vorschlag" as const)
        : row.open !== row.amount
          ? ("teilweise" as const)
          : row.amount < 0
            ? ("belegFehlt" as const)
            : ("offen" as const),
    };
  });
}

type UmsatzAuswahlFilter = Parameters<typeof listTransactions>[1] | "vorschlag";

/** Umsätze eines Kontos oder, in „Alle Konten“, mehrerer, mit Hinweis und Filter wie in der Liste der Bankseite */
export async function umsatzauswahl(konten: readonly Konto[], filter: UmsatzAuswahlFilter, search: string, sortierung: UmsatzSortierung) {
  const ids = konten.map((konto) => konto.id);
  const proposalsOnly = filter === "vorschlag";
  const sqlFilter = proposalsOnly ? "offen" : filter;
  let rows = await listTransactions(ids, sqlFilter, search, sortierung, proposalsOnly ? 0 : undefined);
  const [items, own] = rows.some((row) => row.open !== 0) ? await Promise.all([openItems(), ownAccounts()]) : [[], []];
  const withHints = await mitHinweisen(rows, items, own, konten);
  if (!proposalsOnly) return sortierung.feld === "status" ? nachStatusSortieren(withHints, sortierung.richtung) : withHints;

  // Der Hinweis wird erst aus den offenen Posten und den Buchungen berechnet. Die Grenze gilt daher für Treffer.
  const matches = withHints.filter((row) => row.hint === "vorschlag");
  for (let offset = UMSATZ_LISTENLIMIT; rows.length === UMSATZ_LISTENLIMIT && matches.length < UMSATZ_LISTENLIMIT; offset += UMSATZ_LISTENLIMIT) {
    rows = await listTransactions(ids, sqlFilter, search, sortierung, offset);
    const annotated = await mitHinweisen(rows, items, own, konten);
    matches.push(...annotated.filter((row) => row.hint === "vorschlag"));
  }
  return matches.slice(0, UMSATZ_LISTENLIMIT);
}
