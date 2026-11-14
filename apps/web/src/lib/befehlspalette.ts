import { DUNNING_LEVELS, type DunningLevel, formatEuro } from "@haben/core";
import type { IconName } from "../components/Icon.tsx";
import { searchOptions } from "./combobox.ts";
import { formatDate } from "./format.ts";
import type { SichtbareSeite } from "./navigation.ts";
import type { CommandPaletteResult } from "../server/functions/search.ts";

export type MoreTarget = "/kontakte" | "/rechnungen" | "/angebote" | "/belege";

export type PaletteItem =
  | {
      id: string;
      kind: "page";
      title: string;
      meta: string;
      icon: IconName;
      page: SichtbareSeite;
    }
  | {
      id: string;
      kind: "contact" | "invoice" | "quote" | "document";
      title: string;
      meta: string;
      icon: IconName;
      to: "/kontakte/$id" | "/rechnungen/$id" | "/angebote/$id" | "/belege/$id";
      entityId: string;
      amount?: string;
      invoice?: CommandPaletteResult["invoices"]["hits"][number];
      quote?: CommandPaletteResult["quotes"]["hits"][number];
      document?: CommandPaletteResult["documents"]["hits"][number];
    };

export interface PaletteSection {
  id: string;
  label: string;
  items: PaletteItem[];
  to?: MoreTarget;
}

export function buildPageSection(pages: readonly SichtbareSeite[], query: string): PaletteSection | null {
  const { hits } = searchOptions(pages, query, (p) => [p.label, p.group, p.settingsArea ? (p.keywords ?? "") : p.to], 5);
  if (hits.length === 0) return null;
  return {
    id: "seiten",
    label: "Seiten",
    items: hits.map((page) => ({
      id: `page-${page.key}`,
      kind: "page",
      title: page.label,
      meta: page.key === "uebersicht" ? "" : page.group,
      icon: page.icon,
      page,
    })),
  };
}

const INVOICE_KIND = { rechnung: "Rechnung", storno: "Storno", korrektur: "Korrektur" } as const;

export function buildRemoteSections(remote: CommandPaletteResult, inhaber: boolean): PaletteSection[] {
  const sections: PaletteSection[] = [];

  if (inhaber && remote.contacts.hits.length > 0) {
    const items: PaletteItem[] = remote.contacts.hits.map((c) => ({
      id: `contact-${c.id}`,
      kind: "contact",
      title: c.name,
      meta: [c.isCustomer ? "Kunde" : "", c.isSupplier ? "Lieferant" : "", c.kundennummer, c.lieferantennummer, c.ort].filter(Boolean).join(" · "),
      icon: "contacts",
      to: "/kontakte/$id",
      entityId: c.id,
    }));
    sections.push({ id: "kontakte", label: "Kontakte", items, to: "/kontakte" });
  }

  if (remote.invoices.hits.length > 0) {
    const items: PaletteItem[] = remote.invoices.hits.map((inv) => ({
      id: `invoice-${inv.id}`,
      kind: "invoice",
      title: inv.number ? `${INVOICE_KIND[inv.kind]} ${inv.number}` : "Rechnungsentwurf",
      meta: [
        inv.customer,
        formatDate(inv.issueDate),
        inv.dunning && `${DUNNING_LEVELS[inv.dunning.level as DunningLevel].label} bis ${formatDate(inv.dunning.dueDate)}`,
      ]
        .filter(Boolean)
        .join(" · "),
      amount: formatEuro(inv.gross),
      invoice: inv,
      icon: "invoice",
      to: "/rechnungen/$id",
      entityId: inv.id,
    }));
    sections.push({ id: "rechnungen", label: "Rechnungen", items, to: "/rechnungen" });
  }

  if (inhaber && remote.quotes.hits.length > 0) {
    const items: PaletteItem[] = remote.quotes.hits.map((q) => ({
      id: `quote-${q.id}`,
      kind: "quote",
      title: q.number ?? "Angebotsentwurf",
      meta: `${q.customer} · ${formatDate(q.issueDate)}`,
      amount: formatEuro(q.gross),
      quote: q,
      icon: "quote",
      to: "/angebote/$id",
      entityId: q.id,
    }));
    sections.push({ id: "angebote", label: "Angebote", items, to: "/angebote" });
  }

  if (remote.documents.hits.length > 0) {
    const items: PaletteItem[] = remote.documents.hits.map((doc) => ({
      id: `document-${doc.id}`,
      kind: "document",
      title: doc.supplierName || doc.filename,
      meta: [doc.invoiceNumber || (doc.supplierName ? doc.filename : ""), doc.documentDate ? formatDate(doc.documentDate) : ""].filter(Boolean).join(" · "),
      amount: doc.gross === null ? undefined : formatEuro(doc.gross),
      document: doc,
      icon: "receipt",
      to: "/belege/$id",
      entityId: doc.id,
    }));
    sections.push({ id: "belege", label: "Belege", items, to: "/belege" });
  }

  return sections;
}

export function statusMessage(loading: boolean, queryLength: number, itemCount: number): string {
  if (loading) return "Suche läuft …";
  if (itemCount === 0) return queryLength >= 2 ? "Keine Treffer gefunden." : "Keine passende Seite gefunden.";
  return itemCount === 1 ? "1 Treffer." : `${itemCount} Treffer.`;
}
