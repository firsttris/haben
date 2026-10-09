import { MONTHS, formatEuro, kontoart, type Kontenrahmen } from "@haben/core";
import { Link, createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { Fragment } from "react";
import { z } from "zod/mini";
import { BalanceChart } from "../../../components/BalanceChart.tsx";
import { JOURNAL_SOURCE, SaldoBetrag, ZEITRAEUME, lastDayBefore, shortDate } from "../../../components/Ledger.tsx";
import { formatDate } from "../../../lib/format.ts";
import { getKontenblatt } from "../../../server/functions/ledger.ts";
import styles from "../../../styles/auswertungen.css?url";

export const Route = createFileRoute("/_app/konten/$konto")({
  validateSearch: z.object({
    jahr: z.optional(z.int()),
    zeitraum: z.optional(z.string().check(z.regex(/^(jahr|q[1-4]|m([1-9]|1[0-2]))$/))),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) => {
    if (!/^\d{4,8}$/.test(params.konto)) throw notFound();
    return getKontenblatt({ data: { account: params.konto, year: deps.jahr ?? new Date().getFullYear(), period: deps.zeitraum ?? "jahr" } });
  },
  head: ({ params }) => ({ meta: [{ title: `Konto ${params.konto} · Haben` }], links: [{ rel: "stylesheet", href: styles }] }),
  component: KontenblattPage,
});


function SourceLink({ type, id, reversal }: { type: string; id: string; reversal: boolean }) {
  const label = reversal ? "Gegenbuchung" : (JOURNAL_SOURCE[type as keyof typeof JOURNAL_SOURCE] ?? type);
  if (type === "invoice") return <Link to="/rechnungen/$id" params={{ id }}>{label}</Link>;
  if (type === "document") return <Link to="/belege/$id" params={{ id }}>{label}</Link>;
  if (type === "asset") return <Link to="/anlagen/$id" params={{ id }}>{label}</Link>;
  if (type === "allocation") return <Link to="/bank">{label}</Link>;
  if (type === "pauschale") return <Link to="/pauschalen">{label}</Link>;
  if (type === "kasse") return <Link to="/kasse">{label}</Link>;
  return <>{label}</>;
}

function KontenblattPage() {
  const data = Route.useLoaderData();
  const { konto } = Route.useParams();
  const deps = Route.useSearch();
  const navigate = useNavigate();
  const year = Number(data.from.slice(0, 4));
  const zeitraum = deps.zeitraum ?? "jahr";
  const kr: Kontenrahmen = data.kontenrahmen ?? "SKR03";
  // Ertragskonten aus Sicht des Kontos positiv zeigen, wie in der Saldenliste
  const sign = kontoart(kr, konto, data.saldo) === "ertrag" ? -1 : 1;
  const multiMonth = !zeitraum.startsWith("m");

  // Zeilen nach Monat gruppieren, mit Zwischensumme je Monat
  const months = new Map<string, typeof data.zeilen>();
  for (const z of data.zeilen) months.set(z.date.slice(0, 7), [...(months.get(z.date.slice(0, 7)) ?? []), z]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/konten" search={{ jahr: year, zeitraum }}>
              Konten {year}
            </Link>{" "}
            · Kontenblatt
          </div>
          <h1>
            <span className="mono">{konto}</span> {data.name}
          </h1>
        </div>
        <div className="actions" style={{ alignItems: "end" }}>
          <label className="field">
            Zeitraum
            <select
              value={zeitraum}
              onChange={(e) => navigate({ to: "/konten/$konto", params: { konto }, search: { jahr: year, zeitraum: e.target.value } })}
            >
              {ZEITRAEUME.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <a className="btn" href={`/api/konten/${year}?zeitraum=${zeitraum}&konto=${konto}`}>
            CSV
          </a>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="card">
          <div className="kpi-label">Eröffnung</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>
            <SaldoBetrag kontenrahmen={kr} account={konto} saldo={data.eroeffnung} />
          </div>
          <div className="small muted">am {formatDate(data.from)}</div>
        </div>
        <div className="card kpi-wide">
          <div className="kpi-label">Bewegungen im Zeitraum</div>
          <dl className="facts" style={{ gap: "2px 12px", fontSize: 15 }}>
            <dt>Soll</dt>
            <dd className="mono">{formatEuro(data.soll)}</dd>
            <dt>Haben</dt>
            <dd className="mono">{formatEuro(data.haben)}</dd>
          </dl>
          <div className="small muted">{data.zeilen.length} Buchungen</div>
        </div>
        <div className="card">
          <div className="kpi-label">Saldo am Ende</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>
            <SaldoBetrag kontenrahmen={kr} account={konto} saldo={data.saldo} />
          </div>
          <div className="small muted">am {formatDate(lastDayBefore(data.to))}</div>
        </div>
      </div>

      {data.zeilen.length >= 2 && (
        <section className="card" aria-label="Saldoverlauf" style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Saldoverlauf</h2>
          <BalanceChart
            title={`Saldoverlauf Konto ${konto}`}
            from={data.from}
            to={data.to}
            start={sign * data.eroeffnung}
            points={data.zeilen.map((z) => ({ date: z.date, value: sign * z.saldo, label: z.description }))}
          />
        </section>
      )}

      <section className="card" aria-label="Kontenblatt">
        <table className="report-table sticky-head stack-table">
          <thead>
            <tr>
              <th scope="col">Datum</th>
              <th scope="col">Buchungstext</th>
              <th scope="col">Gegenkonto</th>
              <th scope="col">Herkunft</th>
              <th scope="col" className="num">
                Soll
              </th>
              <th scope="col" className="num">
                Haben
              </th>
              <th scope="col" className="num saldo-head">
                Saldo
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="group-row">
              <td data-label="Datum">{shortDate(data.from)}</td>
              <td colSpan={5}>Eröffnung (Saldo ab Jahresbeginn)</td>
              <td className="num" data-label="Saldo">
                <SaldoBetrag kontenrahmen={kr} account={konto} saldo={data.eroeffnung} />
              </td>
            </tr>
            {[...months.entries()].map(([month, rows]) => (
              <Fragment key={month}>
                {rows.map((z, i) => (
                  <tr key={`${z.entryId}-${i}`}>
                    <td data-label="Datum">{shortDate(z.date)}</td>
                    <td data-label="Text">{z.description}</td>
                    <td className="mono small" data-label="Gegenkonto">
                      {z.gegenkonten.map((g, j) => (
                        <span key={g}>
                          {j > 0 && ", "}
                          <Link to="/konten/$konto" params={{ konto: g }} search={{ jahr: year, zeitraum }}>
                            {g}
                          </Link>
                        </span>
                      ))}
                    </td>
                    <td className="small" data-label="Herkunft">
                      <SourceLink type={z.sourceType} id={z.sourceId} reversal={z.reversal} />
                    </td>
                    <td className="num" data-label="Soll">
                      {z.soll ? formatEuro(z.soll) : ""}
                    </td>
                    <td className="num" data-label="Haben">
                      {z.haben ? formatEuro(z.haben) : ""}
                    </td>
                    <td className="num" data-label="Saldo">
                      <SaldoBetrag kontenrahmen={kr} account={konto} saldo={z.saldo} />
                    </td>
                  </tr>
                ))}
                {multiMonth && (
                  <tr className="subtotal-row">
                    <th scope="row" colSpan={4}>
                      Summe {MONTHS[Number(month.slice(5, 7)) - 1]}
                    </th>
                    <td className="num" data-label="Soll">
                      {formatEuro(rows.reduce((s, z) => s + z.soll, 0))}
                    </td>
                    <td className="num" data-label="Haben">
                      {formatEuro(rows.reduce((s, z) => s + z.haben, 0))}
                    </td>
                    <td className="num" data-label="Saldo">
                      <SaldoBetrag kontenrahmen={kr} account={konto} saldo={rows.at(-1)!.saldo} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {data.zeilen.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Keine Buchungen auf diesem Konto im Zeitraum.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={4}>
                Summe Zeitraum
              </th>
              <td className="num" data-label="Soll">
                {formatEuro(data.soll)}
              </td>
              <td className="num" data-label="Haben">
                {formatEuro(data.haben)}
              </td>
              <td className="num" data-label="Saldo">
                <SaldoBetrag kontenrahmen={kr} account={konto} saldo={data.saldo} />
              </td>
            </tr>
          </tfoot>
        </table>
      </section>
    </>
  );
}
