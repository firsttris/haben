import { currentYear, MONTHS, formatEuro, isKapitalgesellschaft, type EuerLine } from "@haben/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod/mini";
import { barPath, euroAxis, niceTicks, useChartWidth } from "../../lib/chart.ts";
import { formatDate, relativeDays } from "../../lib/format.ts";
import type { OpenPosition } from "../../server/modules/auswertungen/index.ts";
import { getReports } from "../../server/functions/reports.ts";
import styles from "../../styles/auswertungen.css?url";
import { Icon } from "../../components/Icon.tsx";
import { ScrollTable } from "../../components/ScrollTable.tsx";
import { Gesamtumsatz } from "../../components/Gesamtumsatz.tsx";
import { ERSTES_JAHR, LETZTES_JAHR } from "../../lib/jahre.ts";
import { Status } from "../../components/Status.tsx";

export const Route = createFileRoute("/_app/auswertungen")({
  validateSearch: z.object({ jahr: z.optional(z.int().check(z.minimum(ERSTES_JAHR), z.maximum(LETZTES_JAHR))) }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getReports({ data: { year: deps.jahr ?? currentYear() } }),
  head: () => ({ meta: [{ title: "Auswertungen · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: ReportsPage,
});

type Data = Awaited<ReturnType<typeof getReports>>;

const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

function ReportsPage() {
  const { euer, open, years, today, versteuerung, gesamtumsatz } = Route.useLoaderData();
  // GmbH und UG bilanzieren (§ 238 HGB): Die Zahlen nach Zahlung sind dort keine EÜR, den Gewinn zeigt der Jahresabschluss
  const { rechtsform, user } = Route.useRouteContext();
  const gesellschaft = isKapitalgesellschaft(rechtsform);
  const year = euer.year;
  const netIn = euer.monthly.einnahmen.reduce((s, v) => s + v, 0);
  const netOut = euer.monthly.ausgaben.reduce((s, v) => s + v, 0);
  const receivables = [...open.receivables, ...open.unbilledReceivables].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number));
  const overdueCount = receivables.filter((r) => r.daysOverdue > 0).length;
  const yearOptions = [...new Set([...years, year, currentYear()])].sort((a, b) => b - a);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{gesellschaft ? "Zufluss und Abfluss" : "Einnahmen-Überschuss-Rechnung · Zufluss und Abfluss"}</div>
          <h1>Auswertungen {year}</h1>
        </div>
        <div className="actions">
          {/* Die Pfeile tragen keine Zahl: Vor- und Folgejahr stehen oft schon in der Liste (aria-label nennt das Jahr) */}
          <nav className="year-switch" aria-label="Jahr wählen">
            {year > ERSTES_JAHR && (
              <Link to="/auswertungen" search={{ jahr: year - 1 }} className="chip" aria-label={`Vorjahr ${year - 1}`} title={`Vorjahr ${year - 1}`}>
                <Icon name="chevron-left" size={16} />
              </Link>
            )}
            {yearOptions.map((y) => (
              <Link
                key={y}
                to="/auswertungen"
                search={{ jahr: y }}
                className={y === year ? "chip active" : "chip"}
                aria-current={y === year ? "page" : undefined}
              >
                {y}
              </Link>
            ))}
            {year < LETZTES_JAHR && (
              <Link to="/auswertungen" search={{ jahr: year + 1 }} className="chip" aria-label={`Folgejahr ${year + 1}`} title={`Folgejahr ${year + 1}`}>
                <Icon name="chevron-right" size={16} />
              </Link>
            )}
          </nav>
          {!gesellschaft && (
            <a className="btn btn-primary" href={`/api/auswertungen/${year}`} download>
              EÜR als CSV
            </a>
          )}
        </div>
      </div>

      <div className="grid-4">
        <div className="card">
          <div className="kpi-label">Einnahmen {year} (netto)</div>
          <div className="kpi-value">{formatEuro(netIn)}</div>
          <div className="small muted">brutto mit USt {formatEuro(euer.totalEinnahmen)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Ausgaben {year} (netto)</div>
          <div className="kpi-value">{formatEuro(netOut)}</div>
          <div className="small muted">brutto mit Vorsteuer und USt {formatEuro(euer.totalAusgaben)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">
            {gesellschaft ? (euer.gewinn >= 0 ? "Überschuss nach Zahlung" : "Fehlbetrag nach Zahlung") : euer.gewinn >= 0 ? "Gewinn" : "Verlust"} {year}
          </div>
          <div className="kpi-value">{formatEuro(euer.gewinn)}</div>
          <div className="small muted">
            {gesellschaft ? (
              <>Einnahmen minus Ausgaben; den Gewinn zeigt der {user.role === "inhaber" ? <Link to="/abschluss">Jahresabschluss</Link> : "Jahresabschluss"}</>
            ) : (
              "Einnahmen minus Ausgaben laut EÜR"
            )}
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">Offene Forderungen</div>
          <div className="kpi-value">{formatEuro(open.receivablesTotal)}</div>
          <div className="small" style={{ color: overdueCount ? "var(--warn-ink)" : "var(--muted)" }}>
            {receivables.length} Posten
            {overdueCount ? ` · ${overdueCount} überfällig` : ""} · Stand {formatDate(today)}
          </div>
        </div>
      </div>

      {gesamtumsatz && <Gesamtumsatz result={gesamtumsatz} />}

      <section className="card" aria-labelledby="monthly-heading">
        <div className="chart-head">
          <div>
            <h2 id="monthly-heading">Einnahmen und Ausgaben je Monat</h2>
            <p className="small muted" style={{ margin: "4px 0 0" }}>
              Netto nach Zahlungsdatum, ohne Umsatzsteuer, Vorsteuer und Zahlungen an das Finanzamt
            </p>
          </div>
          <ul className="chart-legend" aria-label="Legende">
            <li>
              <span className="swatch swatch-in" aria-hidden="true" />
              Einnahmen
            </li>
            <li>
              <span className="swatch swatch-out" aria-hidden="true" />
              Ausgaben
            </li>
          </ul>
        </div>
        <MonthlyChart year={year} einnahmen={euer.monthly.einnahmen} ausgaben={euer.monthly.ausgaben} />
        <details className="chart-table">
          <summary>Als Tabelle anzeigen</summary>
          <ScrollTable className="report-table">
            <caption className="visually-hidden">Einnahmen und Ausgaben je Monat {year}, netto</caption>
            <thead>
              <tr>
                <th scope="col">Monat</th>
                <th scope="col" className="num">
                  Einnahmen
                </th>
                <th scope="col" className="num">
                  Ausgaben
                </th>
                <th scope="col" className="num">
                  Überschuss
                </th>
              </tr>
            </thead>
            <tbody>
              {MONTHS.map((m, i) => (
                <tr key={m}>
                  <th scope="row">{m}</th>
                  <td className="num">{formatEuro(euer.monthly.einnahmen[i]!)}</td>
                  <td className="num">{formatEuro(euer.monthly.ausgaben[i]!)}</td>
                  <td className="num">{formatEuro(euer.monthly.einnahmen[i]! - euer.monthly.ausgaben[i]!)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Summe</th>
                <td className="num">{formatEuro(netIn)}</td>
                <td className="num">{formatEuro(netOut)}</td>
                <td className="num">{formatEuro(netIn - netOut)}</td>
              </tr>
            </tfoot>
          </ScrollTable>
        </details>
      </section>

      {!gesellschaft && <EuerCard euer={euer} versteuerung={versteuerung} />}

      <OpenTable
        id="receivables"
        title="Offene Forderungen"
        empty="Keine offenen Rechnungen."
        partyLabel="Kunde"
        items={receivables}
        total={open.receivablesTotal}
        overdue={open.receivablesOverdue}
        kind="invoice"
        hint={open.unbilledReceivables.length ? "„Ersatzrechnung offen“: Die Leistung ist erbracht; die Nummer öffnet den bisherigen Schlussbeleg." : undefined}
      />
      <AdvanceOpenTables open={open} />
      <OpenTable
        id="payables"
        title="Offene Verbindlichkeiten"
        empty="Keine offenen Belege."
        partyLabel="Lieferant"
        items={open.payables}
        total={open.payablesTotal}
        overdue={open.payablesOverdue}
        kind="document"
      />
      <OpenTable
        id="umsatzsteuer"
        title="Umsatzsteuer gegenüber dem Finanzamt"
        empty="Keine offene Zahllast oder Erstattung aus abgegebenen Voranmeldungen."
        partyLabel="Gegenüber"
        items={open.vat}
        total={open.vatTotal}
        overdue={open.vatOverdue}
        kind="ustva"
      />
    </>
  );
}

function AdvanceOpenTables({ open }: { open: Data["open"] }) {
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

/** Die EÜR des Jahres nach § 4 Abs. 3 EStG, nur im Einzelunternehmen */
function EuerCard({ euer, versteuerung }: { euer: Data["euer"]; versteuerung: Data["versteuerung"] }) {
  const year = euer.year;
  return (
    <section className="card" aria-labelledby="euer-heading">
      <div>
        <h2 id="euer-heading">Einnahmen-Überschuss-Rechnung {year}</h2>
        <p className="small muted" style={{ margin: "4px 0 0" }}>
          Bruttomethode wie in der Anlage EÜR: vereinnahmte Umsatzsteuer ist Einnahme, gezahlte Vorsteuer und die Umsatzsteuer an das Finanzamt sind Ausgaben (
          {versteuerung === "ist" ? "Ist" : "Soll"}-Versteuerung ändert daran nichts).
        </p>
      </div>
      <ScrollTable className="report-table euer-table">
        <caption className="visually-hidden">Einnahmen-Überschuss-Rechnung {year}</caption>
        <thead>
          <tr>
            <th scope="col">Position</th>
            <th scope="col" className="num">
              Betrag
            </th>
          </tr>
        </thead>
        <EuerSection title="Betriebseinnahmen" lines={euer.einnahmen} total={euer.totalEinnahmen} />
        <EuerSection title="Betriebsausgaben" lines={euer.ausgaben} total={euer.totalAusgaben} />
        <tbody>
          <tr className="euer-result">
            <th scope="row">{euer.gewinn >= 0 ? "Gewinn" : "Verlust"}</th>
            <td className="num">{formatEuro(euer.gewinn)}</td>
          </tr>
          {euer.gewerbesteuerNichtAbziehbar !== 0 && (
            <tr>
              <th scope="row" className="muted">
                Nachrichtlich: Gewerbesteuer und Nebenleistungen darauf, Hinterziehungszinsen; keine Betriebsausgaben (§ 4 Abs. 5b, Abs. 5 Satz 1 Nr. 8a EStG)
              </th>
              <td className="num muted">{formatEuro(euer.gewerbesteuerNichtAbziehbar)}</td>
            </tr>
          )}
        </tbody>
      </ScrollTable>
    </section>
  );
}

function EuerSection({ title, lines, total }: { title: string; lines: EuerLine[]; total: number }) {
  return (
    <tbody>
      <tr className="euer-section">
        <th scope="rowgroup" colSpan={2}>
          {title}
        </th>
      </tr>
      {lines.map((line) => (
        <tr key={line.key} className={line.amount === 0 ? "euer-zero" : undefined}>
          <th scope="row" className="euer-label">
            {line.label}
            {line.note && <span className="small muted"> · {line.note}</span>}
          </th>
          <td className="num">{formatEuro(line.amount)}</td>
        </tr>
      ))}
      <tr className="euer-total">
        <th scope="row">Summe {title}</th>
        <td className="num">{formatEuro(total)}</td>
      </tr>
    </tbody>
  );
}

function OpenTable(props: {
  id: string;
  title: string;
  empty: string;
  partyLabel: string;
  items: OpenPosition[];
  total: number;
  overdue: number;
  kind: "invoice" | "document" | "ustva";
  hint?: string;
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
      {items.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          {props.empty}
        </p>
      ) : (
        <div className="table-scroll">
          <ScrollTable className="report-table open-table">
            <caption className="visually-hidden">{title}, nach Fälligkeit sortiert</caption>
            <thead>
              <tr>
                <th scope="col">Nummer</th>
                <th scope="col">{props.partyLabel}</th>
                <th scope="col">Datum</th>
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
                <tr key={item.id}>
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
                  <td>{formatDate(item.dueDate)}</td>
                  <td className="num">{formatEuro(item.gross)}</td>
                  <td className="num">{formatEuro(item.open)}</td>
                  <td>
                    <OpenStatus item={item} kind={kind} />
                  </td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </div>
      )}
    </section>
  );
}

function OpenStatus({ item, kind }: { item: OpenPosition; kind: "invoice" | "document" | "ustva" }) {
  if (item.balanceKind === "unbilled") return <Status tone="info">Ersatzrechnung offen</Status>;
  if (item.balanceKind === "refund") return <Status>Erstattung offen</Status>;
  if (kind === "ustva" && item.open < 0) return <Status tone="info">Erstattung erwartet</Status>;
  return <DueStatus days={item.daysOverdue} />;
}

function DueStatus({ days }: { days: number }) {
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

const H = 260;
const M = { top: 12, right: 8, bottom: 28, left: 72 };
const GAP = 2;

function MonthlyChart({ year, einnahmen, ausgaben }: { year: number; einnahmen: number[]; ausgaben: number[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [chartRef, W] = useChartWidth();
  const values = [...einnahmen, ...ausgaben];
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const y = (v: number) => M.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const slot = plotW / 12;
  const BAR = Math.min(18, Math.floor(slot * 0.38));
  // Schmale Diagramme: nur jeden zweiten Monat beschriften
  const labelEvery = slot < 34 ? 2 : 1;
  const base = y(0);
  const empty = values.every((v) => v === 0);

  return (
    <div className="chart" ref={chartRef} onPointerLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Säulendiagramm: Einnahmen und Ausgaben je Monat ${year}, netto in Euro`}>
        <g aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className={t === 0 ? "axis-base" : "grid"} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" style={{ textAnchor: "end" }} className="tick">
                {euroAxis.format(t / 100)} €
              </text>
            </g>
          ))}
          {MONTHS_SHORT.map((m, i) =>
            i % labelEvery === 0 ? (
              <text key={m} x={M.left + slot * i + slot / 2} y={H - 8} style={{ textAnchor: "middle" }} className="tick">
                {m}
              </text>
            ) : null,
          )}
        </g>
        {MONTHS.map((m, i) => {
          const cx = M.left + slot * i + slot / 2;
          const inV = einnahmen[i]!;
          const outV = ausgaben[i]!;
          return (
            <g
              key={m}
              className={active === i ? "month active" : "month"}
              tabIndex={0}
              role="img"
              aria-label={`${m}: Einnahmen ${formatEuro(inV)}, Ausgaben ${formatEuro(outV)}`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <rect x={M.left + slot * i} y={M.top} width={slot} height={plotH} className="hit" />
              <path d={barPath(cx - BAR - GAP / 2, base, y(inV), BAR)} className="bar bar-in" />
              <path d={barPath(cx + GAP / 2, base, y(outV), BAR)} className="bar bar-out" />
            </g>
          );
        })}
      </svg>
      {empty && <p className="chart-empty small muted">Keine Zahlungen in {year}.</p>}
      {active !== null && (
        <div
          className="chart-tooltip"
          role="presentation"
          style={{
            left: `${((M.left + slot * active + slot / 2) / W) * 100}%`,
            // am Rand nicht über die Karte hinausragen
            transform: active < 2 ? "translateX(-20%)" : active > 9 ? "translateX(-80%)" : "translateX(-50%)",
          }}
        >
          <div className="tt-title">
            {MONTHS[active]} {year}
          </div>
          <div className="tt-row">
            <span className="tt-key tt-in" />
            <strong>{formatEuro(einnahmen[active]!)}</strong>
            <span className="muted">Einnahmen</span>
          </div>
          <div className="tt-row">
            <span className="tt-key tt-out" />
            <strong>{formatEuro(ausgaben[active]!)}</strong>
            <span className="muted">Ausgaben</span>
          </div>
        </div>
      )}
    </div>
  );
}
