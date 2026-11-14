import type { Rolle } from "../../lib/rollen.ts";
import { type ArchiveHit, searchArchive } from "../modules/archiv/index.ts";
import { type BankTransactionHit, type CashEntryHit, type LoanHit, searchBankTransactions, searchCashEntries, searchLoans } from "../modules/bank/index.ts";
import { type DocumentHit, type RecurringDocumentHit, searchDocuments, searchRecurringDocuments } from "../modules/belege/index.ts";
import {
  type AccountHit,
  type AssetHit,
  type BookingHit,
  type PauschaleHit,
  searchAccounts,
  searchAssets,
  searchBookings,
  searchPauschalen,
} from "../modules/buchhaltung/index.ts";
import { type PostfachDocumentHit, searchPostfachDocuments } from "../modules/finanzamt/index.ts";
import { type ServiceEntryHit, searchServiceEntries } from "../modules/leistungen/index.ts";
import { type EmployeeHit, searchEmployees } from "../modules/lohn/index.ts";
import {
  type InvoiceHit,
  type QuoteHit,
  type RecurringInvoiceHit,
  searchInvoices,
  searchQuotes,
  searchRecurringInvoices,
} from "../modules/rechnungen/index.ts";
import { type ArticleHit, type ContactHit, type TextBlockHit, searchArticles, searchContacts, searchTextBlocks } from "../modules/stammdaten/index.ts";
import { type VatReturnHit, type ZmSubmissionHit, searchVatReturns, searchZmSubmissions } from "../modules/umsatzsteuer/index.ts";

export const COMMAND_PALETTE_LIMIT = 5;

export interface SearchGroup<T> {
  hits: T[];
  more: boolean;
}

export interface CommandPaletteResult {
  contacts: SearchGroup<ContactHit>;
  invoices: SearchGroup<InvoiceHit>;
  quotes: SearchGroup<QuoteHit>;
  documents: SearchGroup<DocumentHit>;
  bankTransactions: SearchGroup<BankTransactionHit>;
  bookings: SearchGroup<BookingHit>;
  accounts: SearchGroup<AccountHit>;
  recurringInvoices: SearchGroup<RecurringInvoiceHit>;
  recurringDocuments: SearchGroup<RecurringDocumentHit>;
  articles: SearchGroup<ArticleHit>;
  textBlocks: SearchGroup<TextBlockHit>;
  serviceEntries: SearchGroup<ServiceEntryHit>;
  assets: SearchGroup<AssetHit>;
  loans: SearchGroup<LoanHit>;
  cashEntries: SearchGroup<CashEntryHit>;
  pauschalen: SearchGroup<PauschaleHit>;
  employees: SearchGroup<EmployeeHit>;
  vatReturns: SearchGroup<VatReturnHit>;
  zmSubmissions: SearchGroup<ZmSubmissionHit>;
  postfachDocuments: SearchGroup<PostfachDocumentHit>;
  archive: SearchGroup<ArchiveHit>;
}

const emptyGroup = <T>(): SearchGroup<T> => ({ hits: [], more: false });

function emptyResult(): CommandPaletteResult {
  return {
    contacts: emptyGroup(),
    invoices: emptyGroup(),
    quotes: emptyGroup(),
    documents: emptyGroup(),
    bankTransactions: emptyGroup(),
    bookings: emptyGroup(),
    accounts: emptyGroup(),
    recurringInvoices: emptyGroup(),
    recurringDocuments: emptyGroup(),
    articles: emptyGroup(),
    textBlocks: emptyGroup(),
    serviceEntries: emptyGroup(),
    assets: emptyGroup(),
    loans: emptyGroup(),
    cashEntries: emptyGroup(),
    pauschalen: emptyGroup(),
    employees: emptyGroup(),
    vatReturns: emptyGroup(),
    zmSubmissions: emptyGroup(),
    postfachDocuments: emptyGroup(),
    archive: emptyGroup(),
  };
}

/**
 * Suche für die Befehlspalette (#617) nach Rolle:
 * - Inhaber durchsucht alle Bereiche (Stufe 1 + Stufe 2).
 * - Steuerberatung sieht ausschließlich festgeschriebene Rechnungen (ohne Entwürfe), Belege, Buchungen und Konten.
 */
export async function runCommandPaletteSearch(rawQuery: string, role: Rolle): Promise<CommandPaletteResult> {
  const query = rawQuery.trim();
  if (query.length < 2) return emptyResult();

  if (role === "inhaber") {
    const [
      contacts,
      invoices,
      quotes,
      documents,
      bankTransactions,
      bookings,
      accounts,
      recurringInvoices,
      recurringDocuments,
      articles,
      textBlocks,
      serviceEntries,
      assets,
      loans,
      cashEntries,
      pauschalen,
      employees,
      vatReturns,
      zmSubmissions,
      postfachDocuments,
      archive,
    ] = await Promise.all([
      searchContacts(query, COMMAND_PALETTE_LIMIT),
      searchInvoices(query, { includeDrafts: true }, COMMAND_PALETTE_LIMIT),
      searchQuotes(query, COMMAND_PALETTE_LIMIT),
      searchDocuments(query, COMMAND_PALETTE_LIMIT),
      searchBankTransactions(query, COMMAND_PALETTE_LIMIT),
      searchBookings(query, COMMAND_PALETTE_LIMIT),
      searchAccounts(query, COMMAND_PALETTE_LIMIT),
      searchRecurringInvoices(query, COMMAND_PALETTE_LIMIT),
      searchRecurringDocuments(query, COMMAND_PALETTE_LIMIT),
      searchArticles(query, COMMAND_PALETTE_LIMIT),
      searchTextBlocks(query, COMMAND_PALETTE_LIMIT),
      searchServiceEntries(query, COMMAND_PALETTE_LIMIT),
      searchAssets(query, COMMAND_PALETTE_LIMIT),
      searchLoans(query, COMMAND_PALETTE_LIMIT),
      searchCashEntries(query, COMMAND_PALETTE_LIMIT),
      searchPauschalen(query, COMMAND_PALETTE_LIMIT),
      searchEmployees(query, COMMAND_PALETTE_LIMIT),
      searchVatReturns(query, COMMAND_PALETTE_LIMIT),
      searchZmSubmissions(query, COMMAND_PALETTE_LIMIT),
      searchPostfachDocuments(query, COMMAND_PALETTE_LIMIT),
      searchArchive(query, COMMAND_PALETTE_LIMIT),
    ]);
    return {
      contacts,
      invoices,
      quotes,
      documents,
      bankTransactions,
      bookings,
      accounts,
      recurringInvoices,
      recurringDocuments,
      articles,
      textBlocks,
      serviceEntries,
      assets,
      loans,
      cashEntries,
      pauschalen,
      employees,
      vatReturns,
      zmSubmissions,
      postfachDocuments,
      archive,
    };
  }

  if (role === "steuerberatung") {
    const [invoices, documents, bookings, accounts] = await Promise.all([
      searchInvoices(query, { includeDrafts: false }, COMMAND_PALETTE_LIMIT),
      searchDocuments(query, COMMAND_PALETTE_LIMIT),
      searchBookings(query, COMMAND_PALETTE_LIMIT),
      searchAccounts(query, COMMAND_PALETTE_LIMIT),
    ]);
    return { ...emptyResult(), invoices, documents, bookings, accounts };
  }

  return emptyResult();
}

export interface RecentPaletteItem {
  type: "contact" | "invoice" | "quote" | "document";
  id: string;
}

export async function resolveRecentPalette(items: RecentPaletteItem[], role: Rolle): Promise<CommandPaletteResult> {
  const result = emptyResult();
  await Promise.all(
    items.map(async ({ type, id }) => {
      if (type === "contact" && role === "inhaber") result.contacts.hits.push(...(await searchContacts({ id }, 1)).hits);
      if (type === "invoice" && (role === "inhaber" || role === "steuerberatung"))
        result.invoices.hits.push(...(await searchInvoices({ id }, { includeDrafts: role === "inhaber" }, 1)).hits);
      if (type === "quote" && role === "inhaber") result.quotes.hits.push(...(await searchQuotes({ id }, 1)).hits);
      if (type === "document" && (role === "inhaber" || role === "steuerberatung")) result.documents.hits.push(...(await searchDocuments({ id }, 1)).hits);
    }),
  );
  return result;
}
