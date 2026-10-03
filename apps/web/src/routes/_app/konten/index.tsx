import { formatEuro, kontenklasse } from "@haben/core";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Saldo, ZEITRAEUME } from "../../../components/Ledger.tsx";
import { formatDate } from "../../../lib/format.ts";
import styles from "../../../styles/auswertungen.css?url";
import { getSaldenliste } from "../../../server/functions/ledger.ts";

const search = z.object({
  jahr: z.number().int().optional(),
  zeitraum: z.string().regex(/^(jahr|q[1-4]|m([1-9]|1[0-2]))$/).optional(),
});

export const Route = createFileRoute("/_app/konten/")({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getSaldenliste({ data: { year: deps.jahr ?? new Date().getFullYear(), period: deps.zeitraum ?? "jahr" } }),
  head: () => ({ meta: [{ title: "Konten · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: KontenPage,
});

function KontenPage() {
  const data = Route.useLoaderData();
  const deps = Route.useSearch();
  const navigate = useNavigate();
  const year = Number(data.from.slice(0, 4));
  const zeitraum = deps.zeitraum ?? "jahr";
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = data.rows.filter((r) => !q || r.account.startsWith(q) || r.name.toLowerCase().includes(q));
    const map = new Map<string, typeof rows>();
    for (const row of rows) {
      const klasse = `${row.account.charAt(0)} · ${kontenklasse(row.kontenrahmen, row.account)}`;
      map.set(klasse, [...(map.get(klasse) ?? []), row]);
    }
    return [...map.entries()];
  }, [data.rows, query]);

  const years = [...new Set([year, ...data.years])].sort((a, b) => b - a);
  const total = (key: "soll" | "haben") => data.rows.reduce((sum, r) => sum + r[key], 0);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Saldenliste</div>
          <h1>Konten {year}</h1>
        </div>
        <div className="actions" style={{ alignItems: "end", flexWrap: "wrap" }}>
          <label className="field">
            Jahr
            <select value={year} onChange={(e) => navigate({ to: "/konten", search: { jahr: Number(e.target.value), zeitraum } })}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Zeitraum
            <select value={zeitraum} onChange={(e) => navigate({ to: "/konten", search: { jahr: year, zeitraum: e.target.value } })}>
              {ZEITRAEUME.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <a className="btn" href={`/api/konten/${year}?zeitraum=${zeitraum}`}>
            CSV
          </a>
        </div>
      </div>

      <section className="card" aria-label="Saldenliste">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <p className="small muted" style={{ margin: 0 }}>
            {formatDate(data.from)} bis {formatDate(new Date(Date.parse(`${data.to}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10))}. Eröffnung = Saldo
            ab Jahresbeginn bis zum Beginn des Zeitraums. S = Soll, H = Haben.
          </p>
          <label className="field" style={{ minWidth: 240 }}>
            Konto suchen
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nummer oder Name" />
          </label>
        </div>
        {data.rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Keine Buchungen in diesem Zeitraum.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col">Konto</th>
                  <th scope="col">Bezeichnung</th>
                  <th scope="col" className="num">
                    Eröffnung
                  </th>
                  <th scope="col" className="num">
                    Soll
                  </th>
                  <th scope="col" className="num">
                    Haben
                  </th>
                  <th scope="col" className="num">
                    Saldo
                  </th>
                </tr>
              </thead>
              {groups.map(([klasse, rows]) => (
                <tbody key={klasse}>
                  <tr>
                    <th colSpan={6} scope="colgroup" className="small muted" style={{ paddingTop: 16 }}>
                      Klasse {klasse}
                    </th>
                  </tr>
                  {rows.map((r) => (
                    <tr key={`${r.kontenrahmen}-${r.account}`}>
                      <td className="mono">
                        <Link to="/konten/$konto" params={{ konto: r.account }} search={{ jahr: year, zeitraum }}>
                          {r.account}
                        </Link>
                      </td>
                      <td>{r.name || <span className="muted">ohne Bezeichnung</span>}</td>
                      <td className="num">{r.eroeffnung ? <Saldo value={r.eroeffnung} /> : ""}</td>
                      <td className="num">{r.soll ? formatEuro(r.soll) : ""}</td>
                      <td className="num">{r.haben ? formatEuro(r.haben) : ""}</td>
                      <td className="num" style={{ fontWeight: 500 }}>
                        <Saldo value={r.saldo} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot>
                <tr style={{ fontWeight: 600 }}>
                  <th scope="row" colSpan={3}>
                    Summe Buchungen im Zeitraum
                  </th>
                  <td className="num">{formatEuro(total("soll"))}</td>
                  <td className="num">{formatEuro(total("haben"))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
