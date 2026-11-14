import type { Rolle } from "../../lib/rollen.ts";
import { type DocumentHit, searchDocuments } from "../modules/belege/index.ts";
import { type InvoiceHit, type QuoteHit, searchInvoices, searchQuotes } from "../modules/rechnungen/index.ts";
import { type ContactHit, searchContacts } from "../modules/stammdaten/index.ts";

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
}

const emptyGroup = <T>(): SearchGroup<T> => ({ hits: [], more: false });

function emptyResult(): CommandPaletteResult {
  return {
    contacts: emptyGroup(),
    invoices: emptyGroup(),
    quotes: emptyGroup(),
    documents: emptyGroup(),
  };
}

/**
 * Suche für die Befehlspalette (#617) nach Rolle:
 * - Inhaber durchsucht Kontakte, alle Rechnungen inkl. Entwürfe, Angebote und Belege.
 * - Steuerberatung sieht ausschließlich festgeschriebene Rechnungen (ohne Entwürfe) und Belege – keine Kontakte, keine Angebote.
 */
export async function runCommandPaletteSearch(rawQuery: string, role: Rolle): Promise<CommandPaletteResult> {
  const query = rawQuery.trim();
  if (query.length < 2) return emptyResult();

  if (role === "inhaber") {
    const [contacts, invoices, quotes, documents] = await Promise.all([
      searchContacts(query, COMMAND_PALETTE_LIMIT),
      searchInvoices(query, { includeDrafts: true }, COMMAND_PALETTE_LIMIT),
      searchQuotes(query, COMMAND_PALETTE_LIMIT),
      searchDocuments(query, COMMAND_PALETTE_LIMIT),
    ]);
    return { contacts, invoices, quotes, documents };
  }

  if (role === "steuerberatung") {
    const [invoices, documents] = await Promise.all([
      searchInvoices(query, { includeDrafts: false }, COMMAND_PALETTE_LIMIT),
      searchDocuments(query, COMMAND_PALETTE_LIMIT),
    ]);
    return { contacts: emptyGroup(), invoices, quotes: emptyGroup(), documents };
  }

  return emptyResult();
}
