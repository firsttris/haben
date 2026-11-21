import { currentYear, MONTHS, formatEuro, isKapitalgesellschaft, vorjahresStand } from "@haben/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod/mini";
import { formatDate } from "../../lib/format.ts";
import { getReports } from "../../server/functions/reports.ts";
import styles from "../../styles/auswertungen.css?url";
import { Icon } from "../../components/Icon.tsx";
import { ScrollTable } from "../../components/ScrollTable.tsx";
import { Gesamtumsatz } from "../../components/Gesamtumsatz.tsx";
import { ERSTES_JAHR, LETZTES_JAHR } from "../../lib/jahre.ts";
import { StandHinweis, StandSchalter } from "../../components/StandSchalter.tsx";
import { AdvanceOpenTables, OpenTable } from "./-auswertungen-offen.tsx";
import { EuerCard, MonthlyChart } from "./-auswertungen-teile.tsx";

export const Route = createFileRoute("/_app/auswertungen")({
  // `stichtag` ist der Schalter „Heute“ / „31.12.“ über den offenen Posten (#1110); er steht in der Adresse,
  // damit ein Link auf den Abschlussstand weitergabefähig ist und die Ansicht ohne JavaScript bedienbar bleibt
  validateSearch: z.object({
    jahr: z.optional(z.int().check(z.minimum(ERSTES_JAHR), z.maximum(LETZTES_JAHR))),
    stichtag: z.optional(z.literal("31.12.")),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getReports({ data: { year: deps.jahr ?? currentYear(), ...(deps.stichtag ? { stichtag: deps.stichtag } : {}) } }),
  head: () => ({ meta: [{ title: "Auswertungen · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const { euer, open, years, stand, stichtag, versteuerung, gesamtumsatz } = Route.useLoaderData();
  // GmbH und UG bilanzieren (§ 238 HGB): Die Zahlen nach Zahlung sind dort keine EÜR, den Gewinn zeigt der Jahresabschluss
  const { rechtsform, user } = Route.useRouteContext();
  const gesellschaft = isKapitalgesellschaft(rechtsform);
  const year = euer.year;
  const heute = currentYear();
  // Der Schalter gilt nur für ein vergangenes Jahr: Im laufenden Jahr sind „heute“ und „31.12.“ dasselbe
  const stichtagMoeglich = year < heute;
  // Ein Wechsel des Jahres nimmt den Stichtag mit, damit die Ansicht durchgehend denselben Tag zeigt (#1110)
  const jahrLink = (y: number) => (stichtag && y < heute ? { jahr: y, stichtag } : { jahr: y });
  const netIn = euer.monthly.einnahmen.reduce((s, v) => s + v, 0);
  const netOut = euer.monthly.ausgaben.reduce((s, v) => s + v, 0);
  const receivables = [...open.receivables, ...open.unbilledReceivables].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number));
  const overdueCount = receivables.filter((r) => r.daysOverdue > 0).length;
  const yearOptions = [...new Set([...years, year, currentYear()])].sort((a, b) => b - a);
  // Was vor dem gewählten Jahr entstanden und noch offen ist (#1110), für Forderungen und Verbindlichkeiten getrennt
  const vorjahr = { forderungen: vorjahresStand(receivables, year), verbindlichkeiten: vorjahresStand(open.payables, year) };

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
              <Link to="/auswertungen" search={jahrLink(year - 1)} className="chip" aria-label={`Vorjahr ${year - 1}`} title={`Vorjahr ${year - 1}`}>
                <Icon name="chevron-left" size={16} />
              </Link>
            )}
            {yearOptions.map((y) => (
              <Link
                key={y}
                to="/auswertungen"
                search={jahrLink(y)}
                className={y === year ? "chip active" : "chip"}
                aria-current={y === year ? "page" : undefined}
              >
                {y}
              </Link>
            ))}
            {year < LETZTES_JAHR && (
              <Link to="/auswertungen" search={jahrLink(year + 1)} className="chip" aria-label={`Folgejahr ${year + 1}`} title={`Folgejahr ${year + 1}`}>
                <Icon name="chevron-right" size={16} />
              </Link>
            )}
          </nav>
          {stichtagMoeglich && <StandSchalter year={year} stichtag={stichtag} />}
          <Link className="btn" to="/auswertungen/bwa" search={{ jahr: year }}>
            BWA
          </Link>
          <Link className="btn" to="/auswertungen/liquiditaet">
            Liquidität
          </Link>
          {!gesellschaft && (
            <a className="btn btn-primary" href={`/api/auswertungen/${year}`} download>
              EÜR als CSV
            </a>
          )}
        </div>
      </div>

      {stichtag && <StandHinweis year={year} />}

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
              "Einnahmen minus Ausgaben mit Umsatzsteuer (EÜR)"
            )}
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">Offene Forderungen</div>
          <div className="kpi-value">{formatEuro(open.receivablesTotal)}</div>
          <div className="small" style={{ color: overdueCount ? "var(--warn-ink)" : "var(--muted)" }}>
            {receivables.length} Posten
            {overdueCount ? ` · ${overdueCount} überfällig` : ""} · Stand {formatDate(stand)}
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
        jahr={year}
        vorjahr={vorjahr.forderungen}
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
        jahr={year}
        vorjahr={vorjahr.verbindlichkeiten}
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
