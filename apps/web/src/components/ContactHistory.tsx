import { EXPENSE_CATEGORIES, formatEuro, type ContactYearTotal, type ExpenseCategory } from "@haben/core";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { legacySource } from "../lib/altbestand.ts";
import { formatDate } from "../lib/format.ts";
import { invoiceTitle } from "../lib/invoice.ts";
import type { ContactHistoryRow, ContactHistorySection } from "../server/modules/auswertungen/index.ts";
import { LEGACY_TYPES } from "./archiv/LegacyVouchers.tsx";
import { DocumentStatus } from "./DocumentStatus.tsx";
import { InvoiceStatus } from "./InvoiceStatus.tsx";
import { YearBars } from "./YearBars.tsx";

// Eigene Namen: Das Formular darüber hat schon einen Abschnitt „Rechnungen“ (Einstellungen), zwei gleich benannte
// Bereiche verwechselt ein Screenreader (axe: landmark-unique)
const TEXT = {
  umsatz: {
    title: "Umsatz und Rechnungen",
    years: "Umsatz je Jahr",
    list: "Rechnungen",
    intro:
      "Festgeschriebene Rechnungen aus Haben und aus dem Archiv des Umzugs, je Jahr nach Rechnungsdatum. Storno, Korrektur und Gutschrift mindern im Jahr ihres Datums. Eine Übersicht, keine EÜR.",
    empty: "Noch keine festgeschriebenen Rechnungen an diesen Kontakt.",
    none: "Keine Rechnungen in",
  },
  ausgaben: {
    title: "Ausgaben und Belege",
    years: "Ausgaben je Jahr",
    list: "Belege",
    intro:
      "Gebuchte Belege aus Haben und aus dem Archiv des Umzugs, je Jahr nach Belegdatum. Ein stornierter Beleg steht in der Liste, zählt aber nicht. Eine Übersicht, keine EÜR.",
    empty: "Noch keine gebuchten Belege von diesem Kontakt.",
    none: "Keine Belege in",
  },
} as const;

/**
 * Rechnungen (Kunde) und Belege (Lieferant) des Kontakts mit Summen je Jahr, aus Haben und dem Altbestand (#587).
 * Ein Abschnitt erscheint mit der Rolle oder sobald es Einträge gibt, damit nichts versteckt bleibt.
 */
export function ContactHistory({
  contactId,
  isCustomer,
  isSupplier,
  history,
}: {
  contactId: string;
  isCustomer: boolean;
  isSupplier: boolean;
  history: { sales: ContactHistorySection; purchases: ContactHistorySection };
}) {
  const showSales = isCustomer || history.sales.years.length > 0;
  const showPurchases = isSupplier || history.purchases.years.length > 0;
  if (!showSales && !showPurchases) return null;
  return (
    <div className="stack contact-history">
      {showSales && <HistorySection contactId={contactId} id="umsatz" section={history.sales} />}
      {showPurchases && <HistorySection contactId={contactId} id="ausgaben" section={history.purchases} />}
    </div>
  );
}

function HistorySection({ contactId, id, section }: { contactId: string; id: keyof typeof TEXT; section: ContactHistorySection }) {
  const text = TEXT[id];
  const navigate = useNavigate();
  const select = (jahr: number) => void navigate({ to: "/kontakte/$id", params: { id: contactId }, search: { jahr }, hash: id, resetScroll: false });
  return (
    <section className="card stack" id={id} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{text.title}</h2>
      <p className="small muted" style={{ margin: 0 }}>
        {text.intro}
      </p>
      {section.years.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          {text.empty}
        </p>
      ) : (
        <>
          {/* Ein Jahr allein braucht kein Diagramm, die Tabelle zeigt es */}
          {section.years.length > 1 && (
            <YearBars years={section.years} selected={section.year} series={id === "umsatz" ? "in" : "out"} label={text.years} onSelect={select} />
          )}
          <YearTotals contactId={contactId} anchor={id} years={section.years} year={section.year} label={text.years} />
          {section.year !== null && (
            <>
              <h3>
                {text.list} {section.year}
              </h3>
              {section.rows.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  {text.none} {section.year}.
                </p>
              ) : (
                <Entries rows={section.rows} label={`${text.list} ${section.year}`} />
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

/** Summen je Jahr; ein Jahr wählt die Liste darunter */
function YearTotals({
  contactId,
  anchor,
  years,
  year,
  label,
}: {
  contactId: string;
  anchor: string;
  years: ContactYearTotal[];
  year: number | null;
  label: string;
}) {
  const archive = years.some((y) => y.archiveNet !== 0 || y.archiveGross !== 0);
  const sum = (key: "count" | "net" | "gross" | "archiveNet") => years.reduce((s, y) => s + y[key], 0);
  return (
    <div className="table" role="group" aria-label={label}>
      <div className="table-row head contact-year-cols">
        <div>Jahr</div>
        <div className="num">Anzahl</div>
        <div className="num">Netto</div>
        <div className="num">Brutto</div>
        <div className="num">{archive ? "davon Altbestand netto" : ""}</div>
      </div>
      {years.map((y) => (
        <Link
          key={y.year}
          to="/kontakte/$id"
          params={{ id: contactId }}
          search={{ jahr: y.year }}
          hash={anchor}
          resetScroll={false}
          activeProps={{}}
          className={y.year === year ? "table-row contact-year-cols selected" : "table-row contact-year-cols"}
          aria-current={y.year === year ? "page" : undefined}
        >
          <div>{y.year}</div>
          <div className="num">{y.count}</div>
          <div className="num">{formatEuro(y.net)}</div>
          <div className="num">{formatEuro(y.gross)}</div>
          <div className="num">{archive ? archiveAmount(y.archiveNet) : ""}</div>
        </Link>
      ))}
      {years.length > 1 && (
        <div className="table-row contact-year-cols total">
          <div>Gesamt</div>
          <div className="num">{sum("count")}</div>
          <div className="num">{formatEuro(sum("net"))}</div>
          <div className="num">{formatEuro(sum("gross"))}</div>
          <div className="num">{archive ? archiveAmount(sum("archiveNet")) : ""}</div>
        </div>
      )}
    </div>
  );
}

/** Ein Jahr ganz ohne Altbestand zeigt einen Strich, keine 0,00 € */
function archiveAmount(net: number): string {
  return net === 0 ? "–" : formatEuro(net);
}

function Entries({ rows, label }: { rows: ContactHistoryRow[]; label: string }) {
  return (
    <div className="table" role="group" aria-label={label}>
      <div className="table-row head contact-entry-cols">
        <div>Datum</div>
        <div>Nummer</div>
        <div>Art</div>
        <div className="num">Netto</div>
        <div className="num">Brutto</div>
        <div>Status</div>
      </div>
      {rows.map((row) => (
        <EntryLink key={row.id} row={row}>
          <div className="small">{formatDate(row.date)}</div>
          <div className="mono small ellipsis">{entryNumber(row)}</div>
          <div className="small ellipsis">{entryKind(row)}</div>
          <div className={row.counts ? "num" : "num muted"}>{formatEuro(row.net)}</div>
          <div className={row.counts ? "num" : "num muted"}>{formatEuro(row.gross)}</div>
          <div>
            <EntryStatus row={row} />
          </div>
        </EntryLink>
      ))}
    </div>
  );
}

function EntryLink({ row, children }: { row: ContactHistoryRow; children: ReactNode }) {
  const className = "table-row contact-entry-cols";
  if (row.kind === "rechnung")
    return (
      <Link to="/rechnungen/$id" params={{ id: row.id }} className={className}>
        {children}
      </Link>
    );
  if (row.kind === "beleg")
    return (
      <Link to="/belege/$id" params={{ id: row.id }} className={className}>
        {children}
      </Link>
    );
  return (
    <Link to="/archiv/beleg/$id" params={{ id: row.id }} className={className}>
      {children}
    </Link>
  );
}

function entryNumber(row: ContactHistoryRow): string {
  if (row.kind === "beleg") return row.number || row.filename;
  return row.number || "–";
}

function entryKind(row: ContactHistoryRow): string {
  if (row.kind === "rechnung") return invoiceTitle(row.invoiceKind, row.variant);
  if (row.kind === "archiv") return LEGACY_TYPES[row.type] ?? row.type;
  if (row.category) return EXPENSE_CATEGORIES[row.category as ExpenseCategory]?.label ?? row.category;
  return row.splitCount > 0 ? `Aufgeteilt auf ${row.splitCount} Zeilen` : "–";
}

function EntryStatus({ row }: { row: ContactHistoryRow }) {
  if (row.kind === "rechnung") return <InvoiceStatus status={row.status} />;
  if (row.kind === "beleg") return <DocumentStatus status="gebucht" extractionStatus="fertig" cancelled={row.cancelledOn !== null} />;
  return <span className="small muted">Archiv · {legacySource(row.source, row.sourceName).name}</span>;
}
