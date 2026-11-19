import { formatEuro, periodKey, periodLabel } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { ELSTER_KIND_LABEL } from "../../../lib/elster.ts";
import { formatDate, formatDateTime } from "../../../lib/format.ts";
import type { getVatPeriod } from "../../../server/functions/vat.ts";
import { OutcomeStatus, Tag } from "../../../components/Status.tsx";

export type PageData = Awaited<ReturnType<typeof getVatPeriod>>;

/** Aufklappbare Liste der Zahlungen, Rechnungen bzw. Belege hinter einer Kennzahl */
export type SourceRows = PageData["figures"]["revenue"] | PageData["figures"]["inputTax"];

export function SourcesToggle({
  kind,
  rows,
  open,
  controls,
  onToggle,
}: {
  kind: "revenue" | "inputTax";
  rows: SourceRows;
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  if (rows.length === 0) return <span className="small muted">keine Buchungen</span>;
  const count = (type: string) => rows.filter((row) => "type" in row && row.type === type).length;
  const plural = (n: number, one: string, many: string) => (n > 0 ? [`${n} ${n === 1 ? one : many}`] : []);
  const summary =
    kind === "inputTax"
      ? `${rows.length} ${rows.length === 1 ? "Beleg" : "Belege"}`
      : [
          ...plural(count("payment"), "Zahlungseingang", "Zahlungseingänge"),
          ...plural(count("invoice"), "Rechnung", "Rechnungen"),
          ...plural(count("entnahme"), "Privatnutzung", "Privatnutzungen"),
          ...plural(count("ausbuchung"), "Ausbuchung", "Ausbuchungen"),
          ...plural(count("direkt"), "Direktbuchung", "Direktbuchungen"),
          ...plural(count("kasse"), "Bareinnahme", "Bareinnahmen"),
        ].join(", ");
  return (
    <button type="button" className="kz-sources-toggle" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      <span aria-hidden="true">{open ? "▾" : "▸"}</span> {summary}
    </button>
  );
}

export function SourcesTable({ id, kind, rows }: { id: string; kind: "revenue" | "inputTax"; rows: SourceRows }) {
  return (
    <div id={id} className="kz-sources">
      <table>
        <thead>
          <tr>
            <th>Datum</th>
            <th>{kind === "inputTax" ? "Beleg" : "Rechnung"}</th>
            <th className="num">Netto</th>
            <th className="num">Steuer</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="date">{formatDate(row.date)}</td>
              <td>
                {"assetId" in row && row.assetId ? (
                  <Link to="/anlagen/$id" params={{ id: row.assetId }}>
                    Privatnutzung · {row.customer}
                  </Link>
                ) : "cashEntryId" in row && row.cashEntryId ? (
                  <Link to="/kasse" search={{ jahr: Number(row.date.slice(0, 4)) }}>
                    Bareinnahme · {row.customer}
                  </Link>
                ) : "transactionId" in row && row.transactionId ? (
                  <Link to="/bank" search={{ umsatz: row.transactionId }}>
                    Direkt gebucht · {row.customer}
                  </Link>
                ) : "invoiceId" in row ? (
                  <Link to="/rechnungen/$id" params={{ id: row.invoiceId }}>
                    {row.number} · {row.customer}
                  </Link>
                ) : (
                  <Link to="/belege/$id" params={{ id: row.documentId }}>
                    {row.supplier}
                    {row.number ? ` · ${row.number}` : ""}
                  </Link>
                )}
              </td>
              <td className="num">{formatEuro(row.base)}</td>
              <td className="num">{formatEuro(row.tax)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function History({ data }: { data: PageData }) {
  return (
    <section className="card" aria-labelledby="history-heading">
      <h2 id="history-heading">Verlauf {periodLabel(data.period)}</h2>
      {data.filings.map((filing) => (
        <div key={filing.id} className="history-row">
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontWeight: 500 }}>
              Abgabe vermerkt <Tag>außerhalb von Haben</Tag>
            </span>
            <span className="small muted" style={{ overflowWrap: "anywhere" }}>
              abgegeben {formatDate(filing.filedOn)} · vermerkt {formatDateTime(filing.createdAt)} · Ticket {filing.transferTicket} · Kz 83{" "}
              {formatEuro(filing.kz83)}
            </span>
          </div>
          <a href={`/api/protokoll/${filing.id}`} target="_blank" rel="noreferrer" className="small">
            Protokoll
          </a>
        </div>
      ))}
      {data.submissions.length === 0 && data.filings.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Noch nichts geprüft oder gesendet.
        </p>
      ) : (
        data.submissions.map((entry) => (
          <div key={entry.id} className="history-row">
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontWeight: 500 }}>
                {ELSTER_KIND_LABEL[entry.kind]} <OutcomeStatus ok={entry.ok}>{entry.ok ? "OK" : `Fehler ${entry.code}`}</OutcomeStatus>
              </span>
              <span className="small muted" style={{ overflowWrap: "anywhere" }}>
                {formatDateTime(entry.createdAt)}
                {entry.transferTicket ? ` · Ticket ${entry.transferTicket}` : ""}
                {!entry.ok ? ` · ${entry.message}` : ""}
              </span>
            </div>
            {entry.hasPdf && (
              <a href={`/api/protokoll/${entry.id}`} target="_blank" rel="noreferrer" className="small">
                Protokoll
              </a>
            )}
          </div>
        ))
      )}
      {data.recent.length > 0 && (
        <>
          <h2 style={{ marginTop: 8 }}>Gesendete Voranmeldungen</h2>
          {data.recent.map((entry) => (
            <div key={entry.id} className="history-row">
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Link to="/umsatzsteuer/$zeitraum" params={{ zeitraum: periodKey(entry) }}>
                  {periodLabel(entry)}
                  {entry.berichtigt ? " (berichtigt)" : ""}
                </Link>
                <span className="small muted">gesendet {formatDate(entry.sentAt!)}</span>
              </div>
              <span className="amount">{formatEuro(entry.kz83)}</span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
