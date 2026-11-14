import { formatEuro } from "@haben/core";
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
    }
  | {
      id: string;
      kind: "more";
      title: string;
      meta: string;
      icon: IconName;
      to: MoreTarget;
    };

export interface PaletteSection {
  id: string;
  label: string;
  items: PaletteItem[];
}

export function buildPageSection(pages: readonly SichtbareSeite[], query: string): PaletteSection | null {
  const { hits } = searchOptions(pages, query, (p) => [p.label, p.group, p.to], query ? 8 : 6);
  if (hits.length === 0) return null;
  return {
    id: "seiten",
    label: "Seiten",
    items: hits.map((page) => ({
      id: `page-${page.key}`,
      kind: "page",
      title: page.label,
      meta: page.group,
      icon: page.icon,
      page,
    })),
  };
}

export function buildRemoteSections(remote: CommandPaletteResult, inhaber: boolean): PaletteSection[] {
  const sections: PaletteSection[] = [];

  if (inhaber && remote.contacts.hits.length > 0) {
    const items: PaletteItem[] = remote.contacts.hits.map((c) => ({
      id: `contact-${c.id}`,
      kind: "contact",
      title: c.name,
      meta: [c.kundennummer || c.lieferantennummer, c.ort].filter(Boolean).join(" · ") || "Kontakt",
      icon: "contacts",
      to: "/kontakte/$id",
      entityId: c.id,
    }));
    items.push({ id: "more-contacts", kind: "more", title: "Alle in Kontakte anzeigen", meta: "Liste filtern", icon: "search", to: "/kontakte" });
    sections.push({ id: "kontakte", label: "Kontakte", items });
  }

  if (remote.invoices.hits.length > 0) {
    const items: PaletteItem[] = remote.invoices.hits.map((inv) => ({
      id: `invoice-${inv.id}`,
      kind: "invoice",
      title: inv.number ?? "Rechnungsentwurf",
      meta: `${inv.customer} · ${formatEuro(inv.gross)}`,
      icon: "invoice",
      to: "/rechnungen/$id",
      entityId: inv.id,
    }));
    items.push({ id: "more-invoices", kind: "more", title: "Alle in Rechnungen anzeigen", meta: "Liste filtern", icon: "search", to: "/rechnungen" });
    sections.push({ id: "rechnungen", label: "Rechnungen", items });
  }

  if (inhaber && remote.quotes.hits.length > 0) {
    const items: PaletteItem[] = remote.quotes.hits.map((q) => ({
      id: `quote-${q.id}`,
      kind: "quote",
      title: q.number ?? "Angebotsentwurf",
      meta: `${q.customer} · ${formatEuro(q.gross)}`,
      icon: "quote",
      to: "/angebote/$id",
      entityId: q.id,
    }));
    items.push({ id: "more-quotes", kind: "more", title: "Alle in Angebote anzeigen", meta: "Liste filtern", icon: "search", to: "/angebote" });
    sections.push({ id: "angebote", label: "Angebote", items });
  }

  if (remote.documents.hits.length > 0) {
    const items: PaletteItem[] = remote.documents.hits.map((doc) => ({
      id: `document-${doc.id}`,
      kind: "document",
      title: doc.supplierName || doc.filename,
      meta: [doc.invoiceNumber || doc.filename, doc.documentDate ? formatDate(doc.documentDate) : "", doc.gross !== null ? formatEuro(doc.gross) : ""]
        .filter(Boolean)
        .join(" · "),
      icon: "receipt",
      to: "/belege/$id",
      entityId: doc.id,
    }));
    items.push({ id: "more-documents", kind: "more", title: "Alle in Belege anzeigen", meta: "Liste filtern", icon: "search", to: "/belege" });
    sections.push({ id: "belege", label: "Belege", items });
  }

  return sections;
}

export function statusMessage(loading: boolean, queryLength: number, itemCount: number): string {
  if (loading) return "Suche läuft …";
  if (itemCount === 0) return queryLength >= 2 ? "Keine Treffer gefunden." : "Keine passende Seite gefunden.";
  return itemCount === 1 ? "1 Treffer." : `${itemCount} Treffer.`;
}
