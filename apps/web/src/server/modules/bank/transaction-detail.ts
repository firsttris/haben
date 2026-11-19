// Ein Umsatz mit Zuordnungen und Vorschlägen für den offenen Teil

import { providerPattern, findPayoutGroup, payoutKey, aufKontoAngeboten, suggestDirectBooking, suggestLohnsteuer, suggestMatches } from "@haben/core";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { bankOpenAmountSql as openAmountSql } from "../../db/bank-open.ts";
import { lstaZahlbetraege } from "../lohn/index.ts";
import { dauerbelegSuggestions } from "./dauerbeleg-vorschlaege.ts";
import { ustvaOpenItems } from "../umsatzsteuer/index.ts";
import { directDebitMatch } from "./lastschrift-abgleich.ts";
import { openItems } from "./offene-posten.ts";
import { sammelrechnungVorschlag } from "./sammelrechnung.ts";
import { privatStand } from "./privat-kennzeichnung.ts";
import { ownAccounts } from "./accounts.ts";
import { learnedDirectSuggestions } from "./learned-suggestions.ts";
import { payoutCandidates, transferCounterpart, type TransferCounterpart } from "./transfers.ts";
import { duplicateReviewsForTransaction } from "./duplicate-review.ts";
import { transactionAllocations } from "./transaction-allocations.ts";

export async function transactionDetail(id: string) {
  const [tx] = await db
    .select({
      id: schema.bankTransactions.id,
      bankAccountId: schema.bankTransactions.bankAccountId,
      bookingDate: schema.bankTransactions.bookingDate,
      valueDate: schema.bankTransactions.valueDate,
      amount: schema.bankTransactions.amount,
      currency: schema.bankTransactions.currency,
      counterpartyName: schema.bankTransactions.counterpartyName,
      counterpartyIban: schema.bankTransactions.counterpartyIban,
      purpose: schema.bankTransactions.purpose,
      type: schema.bankTransactions.type,
      bankReference: schema.bankTransactions.bankReference,
      endToEndId: schema.bankTransactions.endToEndId,
      open: openAmountSql.mapWith(Number),
    })
    .from(schema.bankTransactions)
    .where(eq(schema.bankTransactions.id, id));
  if (!tx) return null;
  const allocations = await transactionAllocations(id);

  const duplicateReviews = await duplicateReviewsForTransaction(tx.id);
  const automatic = duplicateReviews.every((review) => review.decision === "distinct");
  // Offene Rechnungen und Belege, dazu Zahllast und Erstattung abgegebener Voranmeldungen
  const items = tx.open === 0 ? [] : [...(await openItems()), ...(await ustvaOpenItems())];
  // Vorschläge für den noch offenen Teil des Umsatzes
  const suggestions = !automatic || tx.open === 0 ? [] : suggestMatches({ ...tx, amount: tx.open }, items);
  const candidates = items.filter((i) => Math.sign(i.open) === Math.sign(tx.amount));
  // Ohne Rechnung: Vorschlag aus dem Zweck der Konten, bei Geldtransit mit der Gegenbuchung auf dem anderen Konto
  const accounts = await ownAccounts();
  const account = accounts.find((a) => a.id === tx.bankAccountId);
  // Sammelrechnung des Monats an einer Gebührenzeile eines Zahlungsdienstleisters (#680)
  const { sammelrechnung, sammelbeleg } = automatic ? await sammelrechnungVorschlag(tx, account?.purpose, items) : { sammelrechnung: null, sammelbeleg: null };
  let direct = automatic && account && tx.open === tx.amount ? suggestDirectBooking(tx, account, accounts) : null;
  let counterpart: TransferCounterpart | null = null;
  if (direct?.kind === "geldtransit" && account) {
    // Auszahlung vom Dienstleister: Gegenbuchung auf einem Bankkonto, dort mit dem Namen des Dienstleisters
    const targets = direct.counterAccountId ? [direct.counterAccountId] : accounts.filter((a) => a.purpose !== "zahlungsdienstleister").map((a) => a.id);
    const key = account.purpose === "zahlungsdienstleister" ? payoutKey(tx.bankReference) : null;
    if (key) {
      // Teil einer Auszahlung (Shopify): die Bank zeigt die Summe aller Teile mit derselben Auszahlungs-ID
      const parts = (await payoutCandidates([account.id], tx.bookingDate)).filter((p) => payoutKey(p.bankReference) === key);
      const total = parts.reduce((s, p) => s + p.amount, 0);
      const bank = parts.every((p) => p.open === p.amount)
        ? await transferCounterpart({ ...tx, amount: total }, null, targets, providerPattern(account))
        : null;
      counterpart = bank ? { ...bank, payoutIds: parts.filter((p) => p.id !== tx.id).map((p) => p.id) } : null;
    } else {
      counterpart = await transferCounterpart(tx, account.iban, targets, providerPattern(account));
      if (!counterpart && direct.counterAccountId && account.purpose !== "zahlungsdienstleister") {
        // Eingang auf der Bank aus mehreren Teilen einer Auszahlung im Konto des Dienstleisters
        const group = findPayoutGroup(tx, await payoutCandidates([direct.counterAccountId], tx.bookingDate));
        if (group) {
          const [first, ...rest] = group;
          counterpart = {
            id: first!.id,
            bookingDate: first!.bookingDate,
            amount: -tx.amount,
            counterpartyName: first!.counterpartyName,
            payoutIds: rest.map((r) => r.id),
          };
        }
      }
    }
  }
  if (direct?.requiresCounterpart && !counterpart) direct = null;
  // Lohnsteuer: Lastschrift des Finanzamts über den Gesamtbetrag einer übermittelten Lohnsteuer-Anmeldung
  if (automatic && !direct && tx.open === tx.amount) direct = suggestLohnsteuer(tx, await lstaZahlbetraege());
  // Sonst aus früheren Buchungen derselben Gegenpartei (Gebühren, Privat …), schwächer als die Regeln der Kontozwecke
  if (automatic && !direct && account && tx.open === tx.amount) direct = (await learnedDirectSuggestions([tx])).get(tx.id) ?? null;
  // Was auf diesem Konto nicht buchbar ist, wird auch nicht vorgeschlagen, etwa gelernte Gebühren auf dem Privatkonto (#873)
  if (direct && !aufKontoAngeboten(direct.kind, account?.purpose ?? null)) direct = null;
  // Für die Aufteilung auch Posten in Gegenrichtung, etwa der Gebührenbeleg in einer Auszahlung
  // Belege aus Dauerbelegen, die noch zu prüfen sind: auf Klick buchen und zuordnen (bookAndAllocateDauerbeleg)
  const dauerbelege = !automatic || tx.open === 0 ? [] : await dauerbelegSuggestions({ ...tx, amount: tx.open });
  // Lastschriften aus Haben (#445): Sammelgutschrift aufteilen oder Rücklastschrift zuordnen
  const lastschrift = automatic ? await directDebitMatch(tx) : null;
  // Der Sammelbeleg des Monats steht ganz oben, damit er in der Oberfläche als Treffer erscheint
  const vorschlaege = sammelbeleg ? [sammelbeleg, ...suggestions.filter((s) => s.item.id !== sammelbeleg.item.id)] : suggestions;
  // Für die Kennzeichnung „privat, kein Betriebsvorgang" (#1088): Zweck des Kontos und bestehende Markierung
  const stand = await privatStand(tx.id, tx.bankAccountId);
  return {
    ...stand,
    lastschrift,
    duplicateReviews,
    transaction: tx,
    allocations,
    suggestions: vorschlaege,
    sammelrechnung,
    candidates,
    splitCandidates: items,
    dauerbelege,
    direct: direct ? { ...direct, counterpart } : null,
  };
}
