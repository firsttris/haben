// Ein Umsatz mit Zuordnungen und Vorschlägen für den offenen Teil

import {
  providerPattern,
  findPayoutGroup,
  payoutKey,
  aufKontoAngeboten,
  suggestDirectBooking,
  suggestLohnsteuer,
  suggestMatches,
  kategorieText,
  steuerzahlungText,
  darlehenText,
} from "@haben/core";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { bankOpenAmountSql as openAmountSql } from "../../db/bank-open.ts";
import { lstaZahlbetraege } from "../lohn/index.ts";
import { dauerbelegSuggestions } from "./dauerbeleg-vorschlaege.ts";
import { ustvaLabels, ustvaOpenItems } from "../umsatzsteuer/index.ts";
import { directDebitMatch } from "./lastschrift-abgleich.ts";
import { openItems } from "./offene-posten.ts";
import { sammelrechnungVorschlag } from "./sammelrechnung.ts";
import { privatStand } from "./privat-kennzeichnung.ts";
import { ownAccounts } from "./accounts.ts";
import { learnedDirectSuggestions } from "./learned-suggestions.ts";
import { payoutCandidates, transferCounterpart, type TransferCounterpart } from "./transfers.ts";

/** Zuordnungen eines Umsatzes ohne Gegenzeilen, mit Beschriftung und ob sie aufgehoben sind */
async function transactionAllocations(id: string) {
  const allocationRows = await db
    .select({
      id: schema.allocations.id,
      kind: schema.allocations.kind,
      amount: schema.allocations.amount,
      reversesId: schema.allocations.reversesId,
      splitId: schema.allocations.splitId,
      createdAt: schema.allocations.createdAt,
      invoiceId: schema.allocations.invoiceId,
      invoiceNumber: schema.invoices.number,
      documentId: schema.allocations.documentId,
      documentSupplier: schema.documents.supplierName,
      documentNumber: schema.documents.invoiceNumber,
      vatReturnId: schema.allocations.vatReturnId,
      taxType: schema.allocations.taxType,
      taxYear: schema.allocations.taxYear,
      taxItem: schema.allocations.taxItem,
      loanName: schema.loans.name,
      loanPart: schema.allocations.loanPart,
      category: schema.allocations.category,
      taxRate: schema.allocations.taxRate,
    })
    .from(schema.allocations)
    .leftJoin(schema.invoices, eq(schema.invoices.id, schema.allocations.invoiceId))
    .leftJoin(schema.documents, eq(schema.documents.id, schema.allocations.documentId))
    .leftJoin(schema.loans, eq(schema.loans.id, schema.allocations.loanId))
    .where(eq(schema.allocations.transactionId, id))
    // Teile einer Aufteilung haben denselben Zeitstempel (eine Transaktion): Erlös vor Gebühr, damit die Reihenfolge feststeht
    .orderBy(asc(schema.allocations.createdAt), desc(schema.allocations.amount), asc(schema.allocations.id));
  const reversed = new Set(allocationRows.filter((a) => a.reversesId).map((a) => a.reversesId));
  const vatLabels = await ustvaLabels(allocationRows.flatMap((a) => (a.vatReturnId ? [a.vatReturnId] : [])));
  return allocationRows
    .filter((a) => !a.reversesId)
    .map((a) => ({
      ...a,
      reversed: reversed.has(a.id),
      vatReturnLabel: a.vatReturnId ? (vatLabels.get(a.vatReturnId) ?? null) : null,
      steuerLabel: a.taxType && a.taxYear !== null && a.taxItem ? steuerzahlungText({ art: a.taxType, jahr: a.taxYear, posten: a.taxItem }, a.amount) : null,
      darlehenLabel: a.loanName && a.loanPart ? darlehenText(a.loanName, a.loanPart) : null,
      kategorieLabel: a.category && a.taxRate !== null ? kategorieText({ kategorie: a.category, steuersatz: a.taxRate }) : null,
    }));
}

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

  // Offene Rechnungen und Belege, dazu Zahllast und Erstattung abgegebener Voranmeldungen
  const items = tx.open === 0 ? [] : [...(await openItems()), ...(await ustvaOpenItems())];
  // Vorschläge für den noch offenen Teil des Umsatzes
  const suggestions = tx.open === 0 ? [] : suggestMatches({ ...tx, amount: tx.open }, items);
  const candidates = items.filter((i) => Math.sign(i.open) === Math.sign(tx.amount));
  // Ohne Rechnung: Vorschlag aus dem Zweck der Konten, bei Geldtransit mit der Gegenbuchung auf dem anderen Konto
  const accounts = await ownAccounts();
  const account = accounts.find((a) => a.id === tx.bankAccountId);
  // Sammelrechnung des Monats an einer Gebührenzeile eines Zahlungsdienstleisters (#680)
  const { sammelrechnung, sammelbeleg } = await sammelrechnungVorschlag(tx, account?.purpose, items);
  let direct = account && tx.open === tx.amount ? suggestDirectBooking(tx, account, accounts) : null;
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
  if (!direct && tx.open === tx.amount) direct = suggestLohnsteuer(tx, await lstaZahlbetraege());
  // Sonst aus früheren Buchungen derselben Gegenpartei (Gebühren, Privat …), schwächer als die Regeln der Kontozwecke
  if (!direct && account && tx.open === tx.amount) direct = (await learnedDirectSuggestions([tx])).get(tx.id) ?? null;
  // Was auf diesem Konto nicht buchbar ist, wird auch nicht vorgeschlagen, etwa gelernte Gebühren auf dem Privatkonto (#873)
  if (direct && !aufKontoAngeboten(direct.kind, account?.purpose ?? null)) direct = null;
  // Für die Aufteilung auch Posten in Gegenrichtung, etwa der Gebührenbeleg in einer Auszahlung
  // Belege aus Dauerbelegen, die noch zu prüfen sind: auf Klick buchen und zuordnen (bookAndAllocateDauerbeleg)
  const dauerbelege = tx.open === 0 ? [] : await dauerbelegSuggestions({ ...tx, amount: tx.open });
  // Lastschriften aus Haben (#445): Sammelgutschrift aufteilen oder Rücklastschrift zuordnen
  const lastschrift = await directDebitMatch(tx);
  // Der Sammelbeleg des Monats steht ganz oben, damit er in der Oberfläche als Treffer erscheint
  const vorschlaege = sammelbeleg ? [sammelbeleg, ...suggestions.filter((s) => s.item.id !== sammelbeleg.item.id)] : suggestions;
  // Für die Kennzeichnung „privat, kein Betriebsvorgang" (#1088): Zweck des Kontos und bestehende Markierung
  const stand = await privatStand(tx.id, tx.bankAccountId);
  return {
    ...stand,
    lastschrift,
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
