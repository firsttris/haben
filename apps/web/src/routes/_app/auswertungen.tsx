import { formatEuro, type EuerLine } from "@haben/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { formatDate } from "../../lib/format.ts";
import type { OpenPosition } from "../../server/reports.ts";
import { getReports } from "../../server/functions/reports.ts";
import styles from "../../styles/auswertungen.css?url";

export const Route = createFileRoute("/_app/auswertungen")({
  validateSearch: z.object({ jahr: z.number().int().min(2000).max(2100).optional() }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getReports({ data: { year: deps.jahr ?? new Date().getFullYear() } }),
  head: () => ({ meta: [{ title: "Auswertungen · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: ReportsPage,
});

const MONTHS_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONTHS_LONG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function ReportsPage() {
  const { euer, open, years, today, versteuerung } = Route.useLoaderData();
  const year = euer.year;
  const netIn = euer.monthly.einnahmen.reduce((s, v) => s + v, 0);
  const netOut = euer.monthly.ausgaben.reduce((s, v) => s + v, 0);
  const overdueCount = open.receivables.filter((r) => r.daysOverdue > 0).length;
  const yearOptions = [...new Set([...years, year, new Date().getFullYear()])].sort((a, b) => b - a);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Einnahmen-Überschuss-Rechnung · Zufluss und Abfluss</div>
          <h1>Auswertungen {year}</h1>
        </div>
        <div className="actions">
          <nav className="year-switch" aria-label="Jahr wählen">
            <Link to="/auswertungen" search={{ jahr: year - 1 }} className="btn" aria-label={`Vorjahr ${year - 1}`}>
              ‹ {year - 1}
            </Link>
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
            <Link to="/auswertungen" search={{ jahr: year + 1 }} className="btn" aria-label={`Folgejahr ${year + 1}`}>
              {year + 1} ›
            </Link>
          </nav>
          <a className="btn btn-primary" href={`/api/auswertungen/${year}`} download>
            EÜR als CSV
          </a>
        </div>
      </div>

      <div className="banner banner-info" role="note">
        Vorschau nach Zufluss und Abfluss; ersetzt nicht die Anlage EÜR. Anschaffungen über 800 € netto (Anlagevermögen mit
        Abschreibung) bildet Haben noch nicht ab, Hardware zählt als geringwertiges Wirtschaftsgut voll im Jahr der Zahlung.
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
          <div className="kpi-label">{euer.gewinn >= 0 ? "Gewinn" : "Verlust"} {year}</div>
          <div className="kpi-value">{formatEuro(euer.gewinn)}</div>
          <div className="small muted">Einnahmen minus Ausgaben laut EÜR</div>
        </div>
        <div className="card">
          <div className="kpi-label">Offene Forderungen</div>
          <div className="kpi-value">{formatEuro(open.receivablesTotal)}</div>
          <div className="small" style={{ color: overdueCount ? "var(--warn-ink)" : "var(--muted)" }}>
            {open.receivables.length} Posten
            {overdueCount ? ` · ${overdueCount} überfällig` : ""} · Stand {formatDate(today)}
          </div>
        </div>
      </div>

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
          <table className="report-table">
            <caption className="visually-hidden">Einnahmen und Ausgaben je Monat {year}, netto</caption>
            <thead>
              <tr>
                <th scope="col">Monat</th>
                <th scope="col" className="num">Einnahmen</th>
                <th scope="col" className="num">Ausgaben</th>
                <th scope="col" className="num">Überschuss</th>
              </tr>
            </thead>
            <tbody>
              {MONTHS_LONG.map((m, i) => (
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
          </table>
        </details>
      </section>

      <section className="card" aria-labelledby="euer-heading">
        <div>
          <h2 id="euer-heading">Einnahmen-Überschuss-Rechnung {year}</h2>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            Bruttomethode wie in der Anlage EÜR: vereinnahmte Umsatzsteuer ist Einnahme, gezahlte Vorsteuer und die
            Umsatzsteuer an das Finanzamt sind Ausgaben ({versteuerung === "ist" ? "Ist" : "Soll"}-Versteuerung ändert daran nichts).
          </p>
        </div>
        <table className="report-table euer-table">
          <caption className="visually-hidden">Einnahmen-Überschuss-Rechnung {year}</caption>
          <thead>
            <tr>
              <th scope="col">Position</th>
              <th scope="col" className="num">Betrag</th>
            </tr>
          </thead>
          <EuerSection title="Betriebseinnahmen" lines={euer.einnahmen} total={euer.totalEinnahmen} />
          <EuerSection title="Betriebsausgaben" lines={euer.ausgaben} total={euer.totalAusgaben} />
          <tbody>
            <tr className="euer-result">
              <th scope="row">{euer.gewinn >= 0 ? "Gewinn" : "Verlust"}</th>
              <td className="num">{formatEuro(euer.gewinn)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <OpenTable
        id="receivables"
        title="Offene Forderungen"
        empty="Keine offenen Rechnungen."
        partyLabel="Kunde"
        items={open.receivables}
        total={open.receivablesTotal}
        overdue={open.receivablesOverdue}
        kind="invoice"
      />
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
    </>
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
  kind: "invoice" | "document";
}) {
  const { id, title, items, kind } = props;
  return (
    <section className="card" aria-labelledby={`${id}-heading`}>
      <div className="chart-head">
        <h2 id={`${id}-heading`}>{title}</h2>
        <div className="small muted">
          Summe <span className="mono">{formatEuro(props.total)}</span>
          {props.overdue !== 0 && (
            <>
              {" "}· davon überfällig <span className="mono">{formatEuro(props.overdue)}</span>
            </>
          )}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{props.empty}</p>
      ) : (
        <div className="table-scroll">
          <table className="report-table open-table">
            <caption className="visually-hidden">{title}, nach Fälligkeit sortiert</caption>
            <thead>
              <tr>
                <th scope="col">Nummer</th>
                <th scope="col">{props.partyLabel}</th>
                <th scope="col">Datum</th>
                <th scope="col">Fällig</th>
                <th scope="col" className="num">Betrag</th>
                <th scope="col" className="num">Offen</th>
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
                    ) : (
                      <Link to="/belege/$id" params={{ id: item.id }}>
                        {item.number}
                      </Link>
                    )}
                  </th>
                  <td className="ellipsis" title={item.party}>{item.party}</td>
                  <td>{formatDate(item.date)}</td>
                  <td>{formatDate(item.dueDate)}</td>
                  <td className="num">{formatEuro(item.gross)}</td>
                  <td className="num">{formatEuro(item.open)}</td>
                  <td>
                    <DueStatus days={item.daysOverdue} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DueStatus({ days }: { days: number }) {
  if (days > 0) return <span className="pill pill-warn">{days === 1 ? "1 Tag überfällig" : `${days} Tage überfällig`}</span>;
  if (days === 0) return <span className="pill pill-info">heute fällig</span>;
  return <span className="pill">{days === -1 ? "in 1 Tag fällig" : `in ${-days} Tagen fällig`}</span>;
}

/* Diagramm */

const euroAxis = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

/** Runde Achsenschritte (1, 2, 2,5, 5 × 10ⁿ) in Cent */
function niceTicks(min: number, max: number, count = 4): number[] {
  const range = Math.max(max - min, 100_00);
  const raw = range / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) ticks.push(v);
  return ticks;
}

const W = 720;
const H = 260;
const M = { top: 12, right: 8, bottom: 28, left: 72 };
const BAR = 18;
const GAP = 2;

/** Balken mit 4px runder Datenkante, eckig an der Grundlinie */
function barPath(x: number, y0: number, y1: number, w: number): string {
  const h = Math.abs(y1 - y0);
  if (h < 0.5) return "";
  const r = Math.min(4, h, w / 2);
  if (y1 < y0) {
    // positiv: nach oben
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

function MonthlyChart({ year, einnahmen, ausgaben }: { year: number; einnahmen: number[]; ausgaben: number[] }) {
  const [active, setActive] = useState<number | null>(null);
  const values = [...einnahmen, ...ausgaben];
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const y = (v: number) => M.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const slot = plotW / 12;
  const base = y(0);
  const empty = values.every((v) => v === 0);

  return (
    <div className="chart" onPointerLeave={() => setActive(null)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={`Säulendiagramm: Einnahmen und Ausgaben je Monat ${year}, netto in Euro`}
      >
        <g aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className={t === 0 ? "axis-base" : "grid"} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tick">
                {euroAxis.format(t / 100)} €
              </text>
            </g>
          ))}
          {MONTHS_SHORT.map((m, i) => (
            <text key={m} x={M.left + slot * i + slot / 2} y={H - 8} textAnchor="middle" className="tick">
              {m}
            </text>
          ))}
        </g>
        {MONTHS_LONG.map((m, i) => {
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
            {MONTHS_LONG[active]} {year}
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
