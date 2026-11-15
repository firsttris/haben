import { aufKontoAngeboten, type AccountPurpose, suggestDirectBooking, suggestMatches } from "@haben/core";
import { learnedDirectSuggestions, listTransactions, openItems, ownAccounts, UMSATZ_LISTENLIMIT } from "./bank.ts";
import { nachStatusSortieren, type UmsatzSortierung } from "./umsatzliste.ts";

type Umsatz = Awaited<ReturnType<typeof listTransactions>>[number];

type Konto = { id: string; purpose: AccountPurpose };

/** Hinweis je Umsatz; Vorschläge für direkte Buchungen hängen am Konto des Umsatzes, auch in „Alle Konten“ */
async function mitHinweisen(
  umsatze: Umsatz[],
  items: Awaited<ReturnType<typeof openItems>>,
  own: Awaited<ReturnType<typeof ownAccounts>>,
  konten: readonly Konto[],
) {
  const learned = await learnedDirectSuggestions(umsatze.filter((row) => row.open !== 0 && row.open === row.amount));
  return umsatze.map((row) => {
    if (row.neutralized) return { ...row, suggestion: null, hint: "verrechnet" as const };
    if (row.open === 0) return { ...row, suggestion: null, hint: "zugeordnet" as const };
    const current = own.find((account) => account.id === row.bankAccountId);
    const purpose = konten.find((konto) => konto.id === row.bankAccountId)?.purpose ?? "geschaeft";
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
