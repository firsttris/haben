import { aufKontoAngeboten, type AccountPurpose, suggestDirectBooking, suggestMatches } from "@haben/core";
import { learnedDirectSuggestions, listTransactions, openItems, ownAccounts, UMSATZ_LISTENLIMIT } from "./bank.ts";
import { nachStatusSortieren, type UmsatzSortierung } from "./umsatzliste.ts";

type Umsatz = Awaited<ReturnType<typeof listTransactions>>[number];

async function mitHinweisen(
  umsatze: Umsatz[],
  items: Awaited<ReturnType<typeof openItems>>,
  own: Awaited<ReturnType<typeof ownAccounts>>,
  accountId: string,
  purpose: AccountPurpose,
) {
  const current = own.find((account) => account.id === accountId);
  const learned = await learnedDirectSuggestions(umsatze.filter((row) => row.open !== 0 && row.open === row.amount));
  return umsatze.map((row) => {
    if (row.neutralized) return { ...row, suggestion: null, hint: "verrechnet" as const };
    if (row.open === 0) return { ...row, suggestion: null, hint: "zugeordnet" as const };
    const [match] = suggestMatches({ ...row, amount: row.open }, items, 1);
    // PayPal auf dem Bankkonto braucht die Gegenbuchung, die erst die Detailansicht sucht.
    const direct = !match && row.open === row.amount && current ? suggestDirectBooking(row, current, own) : null;
    // Gelernte Buchungsarten müssen auf diesem Konto zulässig sein (#873).
    const previous = learned.get(row.id);
    const hasSuggestion = !!match || (direct !== null && !direct.requiresCounterpart) || (previous !== undefined && aufKontoAngeboten(previous.kind, purpose));
    return {
      ...row,
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

export async function umsatzauswahl(
  account: { id: string; purpose: AccountPurpose },
  filter: UmsatzAuswahlFilter,
  search: string,
  sortierung: UmsatzSortierung,
) {
  const proposalsOnly = filter === "vorschlag";
  const sqlFilter = proposalsOnly ? "offen" : filter;
  let rows = await listTransactions(account.id, sqlFilter, search, sortierung, proposalsOnly ? 0 : undefined);
  const [items, own] = rows.some((row) => row.open !== 0) ? await Promise.all([openItems(), ownAccounts()]) : [[], []];
  const withHints = await mitHinweisen(rows, items, own, account.id, account.purpose);
  if (!proposalsOnly) return sortierung.feld === "status" ? nachStatusSortieren(withHints, sortierung.richtung) : withHints;

  // Der Hinweis wird erst aus den offenen Posten und den Buchungen berechnet. Die Grenze gilt daher für Treffer.
  const matches = withHints.filter((row) => row.hint === "vorschlag");
  for (let offset = UMSATZ_LISTENLIMIT; rows.length === UMSATZ_LISTENLIMIT && matches.length < UMSATZ_LISTENLIMIT; offset += UMSATZ_LISTENLIMIT) {
    rows = await listTransactions(account.id, sqlFilter, search, sortierung, offset);
    const annotated = await mitHinweisen(rows, items, own, account.id, account.purpose);
    matches.push(...annotated.filter((row) => row.hint === "vorschlag"));
  }
  return matches.slice(0, UMSATZ_LISTENLIMIT);
}
