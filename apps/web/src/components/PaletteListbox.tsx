import { Link } from "@tanstack/react-router";
import type { RefObject } from "react";
import type { PaletteItem, PaletteSection } from "../lib/befehlspalette.ts";
import { DocumentStatus } from "./DocumentStatus.tsx";
import { Icon } from "./Icon.tsx";
import { InvoiceStatusBadge } from "./InvoiceStatus.tsx";
import { QuoteStatusBadge } from "./QuoteStatus.tsx";

interface PaletteListboxProps {
  baseId: string;
  listboxId: string;
  sections: PaletteSection[];
  loading: boolean;
  query: string;
  onNavigate: () => void;
  safeActive: number;
  optionRefs: RefObject<Map<string, HTMLDivElement>>;
  onHover: (index: number) => void;
  onSelect: (item: PaletteItem) => void;
}

export function PaletteListbox({ baseId, listboxId, sections, loading, query, safeActive, optionRefs, onHover, onSelect, onNavigate }: PaletteListboxProps) {
  let runningIndex = 0;
  return (
    <div className="cmd-list">
      {sections.length === 0 && (
        <p className="cmd-empty">{loading ? "Suche läuft …" : query.length < 2 ? "Mindestens 2 Zeichen für die Datensuche." : "Keine Treffer gefunden."}</p>
      )}
      <div
        id={listboxId}
        role="listbox"
        aria-label="Suchergebnisse"
        aria-owns={sections.map((section) => `${baseId}-group-${section.id}`).join(" ") || undefined}
        hidden={sections.length === 0}
      />
      {sections.map((section) => {
        const groupId = `${baseId}-group-${section.id}`;
        const headingId = `${groupId}-heading`;
        return (
          <div key={section.id} className="cmd-group">
            <div className="cmd-group-head">
              <span id={headingId}>{section.label}</span>
              {section.to && (
                <Link
                  to={section.to}
                  search={{ suche: query }}
                  aria-label={`Alle anzeigen: ${section.label}`}
                  onClick={(event) => {
                    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onNavigate();
                  }}
                >
                  Alle anzeigen
                </Link>
              )}
            </div>
            <div id={groupId} role="group" aria-labelledby={headingId}>
              {section.items.map((item) => {
                const index = runningIndex++;
                return (
                  <div
                    key={item.id}
                    id={`${baseId}-opt-${item.id}`}
                    ref={(node) => {
                      if (node) optionRefs.current.set(item.id, node);
                      else optionRefs.current.delete(item.id);
                    }}
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === safeActive}
                    className="cmd-option"
                    onMouseEnter={() => onHover(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onSelect(item)}
                  >
                    <span className="cmd-option-icon">
                      <Icon name={item.icon} size={16} />
                    </span>
                    <span className="cmd-option-text">
                      <span className="cmd-option-title">{highlightMatch(item.title, query)}</span>
                      {item.meta && <span className="cmd-option-meta">{highlightMatch(item.meta, query)}</span>}
                    </span>
                    {item.kind !== "page" && item.amount && <span className="amount">{highlightMatch(item.amount, query)}</span>}
                    {item.kind !== "page" && (item.invoiceStatus || item.quoteStatus || item.document) && (
                      <span className="cmd-option-status">
                        <PaletteItemStatus item={item} />
                      </span>
                    )}
                    <span className="cmd-option-arrow">
                      <Icon name="chevron-right" size={16} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function highlightMatch(text: string, query: string) {
  const index = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (index < 0) return text;
  const end = index + query.length;
  return (
    <>
      {text.slice(0, index)}
      <strong>{text.slice(index, end)}</strong>
      {text.slice(end)}
    </>
  );
}

function PaletteItemStatus({ item }: { item: Exclude<PaletteItem, { kind: "page" }> }) {
  if (item.invoiceStatus) return <InvoiceStatusBadge status={item.invoiceStatus} />;
  if (item.quoteStatus) return <QuoteStatusBadge status={item.quoteStatus} />;
  if (item.document) return <DocumentStatus {...item.document} />;
  return null;
}
