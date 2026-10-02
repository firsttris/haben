import { formatEuro } from "@haben/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { formatDate } from "../../lib/format.ts";
import type { ArchiveSearch } from "../../routes/_app/archiv/index.tsx";
import type { getDatevBookings } from "../../server/functions/archive.ts";
import { YearSwitch } from "./YearSwitch.tsx";

type Data = Awaited<ReturnType<typeof getDatevBookings>>;

export function DatevBookings({ year, years, data, search }: { year: number; years: number[]; data: Data; search: ArchiveSearch }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState(search.suche ?? "");
  const page = search.seite ?? 0;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  function onSearch(event: FormEvent) {
    event.preventDefault();
    void navigate({ to: "/archiv", search: { ...search, suche: term || undefined, seite: undefined } });
  }

  return (
    <div className="stack">
      <section className="card stack" aria-label={`DATEV-Buchungen ${year}`}>
        <YearSwitch year={year} years={years} search={search} />
        <div className="filter-row" style={{ justifyContent: "space-between" }}>
          <Link
            to="/archiv" activeProps={{}}
            search={{ ...search, ohneBeleg: search.ohneBeleg ? undefined : true, seite: undefined }}
            className={search.ohneBeleg ? "chip active" : "chip"}
            aria-pressed={Boolean(search.ohneBeleg)}
          >
            Nur ohne passenden Beleg
          </Link>
          <form onSubmit={onSearch} role="search">
            <label className="search-box">
              <span className="visually-hidden">Suchen</span>
              <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Text, Belegnummer, Konto" />
            </label>
          </form>
        </div>
        {data.rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {data.total === 0 && !search.suche && !search.ohneBeleg
              ? "Für dieses Jahr ist kein DATEV-Buchungsstapel übernommen."
              : "Keine Buchungen für diese Auswahl."}
          </p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Beleg</th>
                  <th>Buchungstext</th>
                  <th>Konto</th>
                  <th>Gegenkonto</th>
                  <th>BU</th>
                  <th className="num">Soll</th>
                  <th className="num">Haben</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id} className={row.matched ? undefined : "unmatched"}>
                    <td>{formatDate(row.date)}</td>
                    <td className="mono">
                      {row.voucherField1 || "–"}
                      {!row.matched && <span className="visually-hidden"> (kein passender Beleg)</span>}
                    </td>
                    <td>
                      {row.text}
                      <div className="small muted">
                        {row.filename}, Zeile {row.row}
                      </div>
                    </td>
                    <td className="mono">{row.account}</td>
                    <td className="mono">{row.contraAccount}</td>
                    <td className="mono">{row.buKey}</td>
                    <td className="num mono">{row.side === "S" ? formatEuro(row.amount) : ""}</td>
                    <td className="num mono">{row.side === "H" ? formatEuro(row.amount) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <nav className="filter-row" aria-label="Seiten">
            {page > 0 && (
              <Link to="/archiv" activeProps={{}} search={{ ...search, seite: page - 1 || undefined }} className="btn">
                ‹ zurück
              </Link>
            )}
            <span className="small muted">
              Seite {page + 1} von {pages} · {data.total} Buchungen
            </span>
            {page + 1 < pages && (
              <Link to="/archiv" activeProps={{}} search={{ ...search, seite: page + 1 }} className="btn">
                weiter ›
              </Link>
            )}
          </nav>
        )}
      </section>
      {data.totals.length > 0 && (
        <section className="card stack" aria-labelledby="totals-heading">
          <h2 id="totals-heading" style={{ margin: 0 }}>Umsätze je Konto {year}</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Summe aller Buchungen auf jedem Konto, wie im DATEV-Stapel. Wo eine Steuerautomatik greift, sind die Beträge brutto.
          </p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Konto</th>
                  <th className="num">Soll</th>
                  <th className="num">Haben</th>
                  <th className="num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {data.totals.map((row) => (
                  <tr key={row.account}>
                    <td className="mono">{row.account}</td>
                    <td className="num mono">{formatEuro(row.debit)}</td>
                    <td className="num mono">{formatEuro(row.credit)}</td>
                    <td className="num mono">
                      {formatEuro(Math.abs(row.debit - row.credit))} {row.debit >= row.credit ? "S" : "H"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
