import { formatEuro, type VorjahresStand, vorjahresVermerk } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { formatDate, relativeDays } from "../../lib/format.ts";
import type { OpenPosition } from "../../server/modules/auswertungen/index.ts";
import type { getReports } from "../../server/functions/reports.ts";
import { ScrollTable } from "../../components/ScrollTable.tsx";
import { Status } from "../../components/Status.tsx";

export type Data = Awaited<ReturnType<typeof getReports>>;

export function AdvanceOpenTables({ open }: { open: Data["open"] }) {
  return (
    <>
      {open.advanceRequests.length > 0 && (
        <OpenTable
          id="advance-requests"
          title="Offene Anzahlungsanforderungen"
          empty="Keine offenen Anzahlungsanforderungen."
          partyLabel="Kunde"
          items={open.advanceRequests}
          total={open.advanceRequestsTotal}
          overdue={open.advanceRequests.filter((p) => p.daysOverdue > 0).reduce((sum, p) => sum + p.open, 0)}
          kind="invoice"
          hint="Diese Anforderungen sind noch keine bilanzierten Forderungen."
        />
      )}
      {open.advanceRefunds.length > 0 && (
        <OpenTable
          id="advance-refunds"
          title="Erstattungen aus Anzahlungen"
          empty="Keine offenen Erstattungen."
          partyLabel="Kunde"
          items={open.advanceRefunds}
          total={open.advanceRefundsTotal}
          overdue={0}
          kind="invoice"
        />
      )}
    </>
  );
}

export function OpenTable(props: {
  id: string;
  title: string;
  empty: string;
  partyLabel: string;
  items: OpenPosition[];
  total: number;
  overdue: number;
  kind: "invoice" | "document" | "ustva";
  hint?: string;
  /** Gewähltes Jahr: Posten mit Datum davor bekommen ihre Kennzeichnung, ohne die Tabellen zu filtern (#1110) */
  jahr?: number;
  /** Wie viel davon aus früheren Jahren stammt; steht als Zeile über der Tabelle */
  vorjahr?: VorjahresStand;
}) {
  const { id, title, items, kind } = props;
  return (
    <section id={id} className="card" aria-labelledby={`${id}-heading`}>
      <div className="chart-head">
        <h2 id={`${id}-heading`}>{title}</h2>
        <div className="small muted">
          Summe <span className="amount">{formatEuro(props.total)}</span>
          {props.overdue !== 0 && (
            <>
              {" "}
              · davon überfällig <span className="amount">{formatEuro(props.overdue)}</span>
            </>
          )}
        </div>
      </div>
      {props.hint && (
        <p className="small muted" style={{ margin: 0 }}>
          {props.hint}
        </p>
      )}
      {props.vorjahr?.text && (
        <p className="small vorjahres-hinweis" style={{ margin: 0 }}>
          {props.vorjahr.text} · <span className="amount">{formatEuro(props.vorjahr.betrag)}</span>
        </p>
      )}
      {items.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          {props.empty}
        </p>
      ) : (
        <div className="table-scroll">
          <ScrollTable className={props.jahr == null ? "report-table open-table" : "report-table open-table mit-jahr"}>
            <caption className="visually-hidden">{title}, nach Fälligkeit sortiert</caption>
            <thead>
              <tr>
                <th scope="col">Nummer</th>
                <th scope="col">{props.partyLabel}</th>
                <th scope="col">Datum</th>
                {props.jahr != null && <th scope="col">Jahr</th>}
                <th scope="col">Fällig</th>
                <th scope="col" className="num">
                  Betrag
                </th>
                <th scope="col" className="num">
                  Offen
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <OpenRow key={item.id} item={item} kind={kind} jahr={props.jahr} />
              ))}
            </tbody>
          </ScrollTable>
        </div>
      )}
    </section>
  );
}

/** Eine Zeile der offenen Posten; mit `jahr` kennzeichnet sie Posten aus früheren Jahren (#1110) */
export function OpenRow({ item, kind, jahr }: { item: OpenPosition; kind: "invoice" | "document" | "ustva"; jahr?: number }) {
  const vermerk = jahr == null ? null : vorjahresVermerk(item.date, jahr);
  return (
    <tr>
      <th scope="row" className="mono small">
        {kind === "invoice" ? (
          <Link to="/rechnungen/$id" params={{ id: item.id }}>
            {item.number}
          </Link>
        ) : kind === "ustva" ? (
          <Link to="/umsatzsteuer/$zeitraum" params={{ zeitraum: item.id }}>
            {item.number}
          </Link>
        ) : (
          <Link to="/belege/$id" params={{ id: item.id }}>
            {item.number}
          </Link>
        )}
      </th>
      <td className="ellipsis" title={item.party}>
        {item.party}
      </td>
      <td>{formatDate(item.date)}</td>
      {jahr != null && <td className={vermerk ? "jahr vorjahr" : "jahr"}>{item.date.slice(0, 4)}</td>}
      <td>
        {formatDate(item.dueDate)}
        {/* Am Handy steht die Spalte „Jahr“ nicht; dort hängt der Vermerk an der Fälligkeit */}
        {vermerk && <span className="vorjahr-handy"> · {vermerk}</span>}
      </td>
      <td className="num">{formatEuro(item.gross)}</td>
      <td className="num">{formatEuro(item.open)}</td>
      <td>
        <OpenStatus item={item} kind={kind} />
      </td>
    </tr>
  );
}

export function OpenStatus({ item, kind }: { item: OpenPosition; kind: "invoice" | "document" | "ustva" }) {
  if (item.balanceKind === "unbilled") return <Status tone="info">Ersatzrechnung offen</Status>;
  if (item.balanceKind === "refund") return <Status>Erstattung offen</Status>;
  if (kind === "ustva" && item.open < 0) return <Status tone="info">Erstattung erwartet</Status>;
  return <DueStatus days={item.daysOverdue} />;
}

export function DueStatus({ days }: { days: number }) {
  if (days > 0)
    return (
      <Status tone="warn" emphasis="urgent" detail={relativeDays(-days)}>
        Überfällig
      </Status>
    );
  if (days === 0)
    return (
      <Status tone="warn" emphasis="notice" detail="heute">
        Fällig
      </Status>
    );
  return <Status detail={relativeDays(-days)}>Offen</Status>;
}

/* Diagramm */
