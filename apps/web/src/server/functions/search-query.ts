import type { Rolle } from "../../lib/rollen.ts";
import { mitHoechstens, type PaletteModule, paletteGroups, paletteModules } from "./search-plan.ts";
import { type ArchiveHit, searchArchive } from "../modules/archiv/index.ts";
import { type BankTransactionHit, type CashEntryHit, type LoanHit, searchBank } from "../modules/bank/index.ts";
import { type DocumentHit, type RecurringDocumentHit, searchBelege, searchDocuments } from "../modules/belege/index.ts";
import { type AccountHit, type AssetHit, type BookingHit, type PauschaleHit, searchBuchhaltung } from "../modules/buchhaltung/index.ts";
import { type PostfachDocumentHit, searchPostfachDocuments } from "../modules/finanzamt/index.ts";
import { type ServiceEntryHit, searchServiceEntries } from "../modules/leistungen/index.ts";
import { type EmployeeHit, searchEmployees } from "../modules/lohn/index.ts";
import { type InvoiceHit, type QuoteHit, type RecurringInvoiceHit, searchInvoices, searchQuotes, searchRechnungen } from "../modules/rechnungen/index.ts";
import { type ArticleHit, type ContactHit, type TextBlockHit, searchContacts, searchStammdaten } from "../modules/stammdaten/index.ts";
import { type VatReturnHit, type ZmSubmissionHit, searchUmsatzsteuer } from "../modules/umsatzsteuer/index.ts";

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

/** Höchstens so viele Module einer Eingabe gleichzeitig; der Pool hat 10 Verbindungen (db/index.ts) */
export const PALETTE_PARALLEL = 4;

/** Je Modul die Suche über seine gefragten Gruppen, in einer Abfrage; welche Gruppen, entscheidet `paletteGroups` */
const SUCHE: { [M in PaletteModule]: (query: string, groups: string[], role: Rolle) => Promise<Partial<CommandPaletteResult>> } = {
  stammdaten: (q, groups) => searchStammdaten(q, groups, COMMAND_PALETTE_LIMIT),
  // Entwürfe nur für den Inhaber
  rechnungen: (q, groups, role) => searchRechnungen(q, groups, { includeDrafts: role === "inhaber" }, COMMAND_PALETTE_LIMIT),
  belege: (q, groups) => searchBelege(q, groups, COMMAND_PALETTE_LIMIT),
  bank: (q, groups) => searchBank(q, groups, COMMAND_PALETTE_LIMIT),
  buchhaltung: (q, groups) => searchBuchhaltung(q, groups, COMMAND_PALETTE_LIMIT),
  leistungen: async (q) => ({ serviceEntries: await searchServiceEntries(q, COMMAND_PALETTE_LIMIT) }),
  lohn: async (q) => ({ employees: await searchEmployees(q, COMMAND_PALETTE_LIMIT) }),
  umsatzsteuer: (q, groups) => searchUmsatzsteuer(q, groups, COMMAND_PALETTE_LIMIT),
  finanzamt: async (q) => ({ postfachDocuments: await searchPostfachDocuments(q, COMMAND_PALETTE_LIMIT) }),
  archiv: async (q) => ({ archive: await searchArchive(q, COMMAND_PALETTE_LIMIT) }),
};

/**
 * Suche für die Befehlspalette (#617): nur die Gruppen, die Rolle und Eingabe zulassen (`paletteGroups`), je Modul eine
 * Abfrage, höchstens `PALETTE_PARALLEL` gleichzeitig. Die Steuerberatung sieht festgeschriebene Rechnungen, Belege,
 * Buchungen und Konten.
 */
export async function runCommandPaletteSearch(rawQuery: string, role: Rolle): Promise<CommandPaletteResult> {
  const query = rawQuery.trim();
  const found = await mitHoechstens(
    PALETTE_PARALLEL,
    paletteModules(paletteGroups(query, role)).map(
      ({ modul, groups }) =>
        () =>
          SUCHE[modul](query, groups, role),
    ),
  );
  return Object.assign(emptyResult(), ...found);
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
