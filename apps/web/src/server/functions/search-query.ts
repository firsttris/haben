import type { Rolle } from "../../lib/rollen.ts";
import { mitHoechstens, type PaletteGroup, paletteGroups } from "./search-plan.ts";
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

/** Höchstens so viele Abfragen einer Eingabe gleichzeitig; der Pool hat 10 Verbindungen (db/index.ts) */
export const PALETTE_PARALLEL = 4;

/** Je Gruppe die Suche im Modul; die Rolle entscheidet `paletteGroups` */
const SUCHE: { [G in PaletteGroup]: (query: string, role: Rolle) => Promise<CommandPaletteResult[G]> } = {
  contacts: (q) => searchContacts(q, COMMAND_PALETTE_LIMIT),
  // Entwürfe nur für den Inhaber
  invoices: (q, role) => searchInvoices(q, { includeDrafts: role === "inhaber" }, COMMAND_PALETTE_LIMIT),
  quotes: (q) => searchQuotes(q, COMMAND_PALETTE_LIMIT),
  documents: (q) => searchDocuments(q, COMMAND_PALETTE_LIMIT),
  bankTransactions: (q) => searchBankTransactions(q, COMMAND_PALETTE_LIMIT),
  bookings: (q) => searchBookings(q, COMMAND_PALETTE_LIMIT),
  accounts: (q) => searchAccounts(q, COMMAND_PALETTE_LIMIT),
  recurringInvoices: (q) => searchRecurringInvoices(q, COMMAND_PALETTE_LIMIT),
  recurringDocuments: (q) => searchRecurringDocuments(q, COMMAND_PALETTE_LIMIT),
  articles: (q) => searchArticles(q, COMMAND_PALETTE_LIMIT),
  textBlocks: (q) => searchTextBlocks(q, COMMAND_PALETTE_LIMIT),
  serviceEntries: (q) => searchServiceEntries(q, COMMAND_PALETTE_LIMIT),
  assets: (q) => searchAssets(q, COMMAND_PALETTE_LIMIT),
  loans: (q) => searchLoans(q, COMMAND_PALETTE_LIMIT),
  cashEntries: (q) => searchCashEntries(q, COMMAND_PALETTE_LIMIT),
  pauschalen: (q) => searchPauschalen(q, COMMAND_PALETTE_LIMIT),
  employees: (q) => searchEmployees(q, COMMAND_PALETTE_LIMIT),
  vatReturns: (q) => searchVatReturns(q, COMMAND_PALETTE_LIMIT),
  zmSubmissions: (q) => searchZmSubmissions(q, COMMAND_PALETTE_LIMIT),
  postfachDocuments: (q) => searchPostfachDocuments(q, COMMAND_PALETTE_LIMIT),
  archive: (q) => searchArchive(q, COMMAND_PALETTE_LIMIT),
};

/**
 * Suche für die Befehlspalette (#617): nur die Gruppen, die Rolle und Eingabe zulassen (`paletteGroups`), höchstens
 * `PALETTE_PARALLEL` gleichzeitig. Die Steuerberatung sieht festgeschriebene Rechnungen, Belege, Buchungen und Konten.
 */
export async function runCommandPaletteSearch(rawQuery: string, role: Rolle): Promise<CommandPaletteResult> {
  const query = rawQuery.trim();
  const groups = paletteGroups(query, role);
  const result = emptyResult();
  const found = await mitHoechstens<unknown>(
    PALETTE_PARALLEL,
    groups.map((group) => () => SUCHE[group](query, role)),
  );
  groups.forEach((group, i) => {
    (result as Record<PaletteGroup, unknown>)[group] = found[i];
  });
  return result;
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
