import { formatEuro, kontenkennzahlen, kontenklasse } from "@haben/core";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod/mini";
import { SaldoBetrag, ZEITRAEUME } from "../../../components/Ledger.tsx";
import { formatDate } from "../../../lib/format.ts";
import { getSaldenliste } from "../../../server/functions/ledger.ts";
import styles from "../../../styles/auswertungen.css?url";

const search = z.object({
  jahr: z.optional(z.int()),
  zeitraum: z.optional(z.string().check(z.regex(/^(jahr|q[1-4]|m([1-9]|1[0-2]))$/))),
});

export const Route = createFileRoute("/_app/konten/")({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getSaldenliste({ data: { year: deps.jahr ?? new Date().getFullYear(), period: deps.zeitraum ?? "jahr" } }),
  head: () => ({ meta: [{ title: "Konten · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: KontenPage,
});

type Row = Awaited<ReturnType<typeof getSaldenliste>>["rows"][number];

function Kpi({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ fontSize: 22 }}>
        {formatEuro(value)}
      </div>
      <div className="small muted">{hint}</div>
    </div>
  );
}

function KontenPage() {
  const data = Route.useLoaderData();
  const deps = Route.useSearch();
  const navigate = useNavigate();
  const year = Number(data.from.slice(0, 4));
  const zeitraum = deps.zeitraum ?? "jahr";
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const until = new Date(Date.parse(`${data.to}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const k = useMemo(() => kontenkennzahlen(data.rows), [data.rows]);
  // Eröffnung nur zeigen, wenn es vor dem Zeitraum schon Buchungen gab
  const showOpening = data.rows.some((r) => r.eroeffnung !== 0);
  const cols = showOpening ? 6 : 5;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = data.rows.filter((r) => !q || r.account.startsWith(q) || r.name.toLowerCase().includes(q));
    const map = new Map<string, Row[]>();
    for (const row of rows) {
      const klasse = `${row.account.charAt(0)} · ${kontenklasse(row.kontenrahmen, row.account)}`;
      map.set(klasse, [...(map.get(klasse) ?? []), row]);
    }
    return [...map.entries()].map(([klasse, list]) => ({
      klasse,
      rows: list,
      soll: list.reduce((s, r) => s + r.soll, 0),
      haben: list.reduce((s, r) => s + r.haben, 0),
    }));
  }, [data.rows, query]);

  const years = [...new Set([year, ...data.years])].sort((a, b) => b - a);
  const total = (key: "soll" | "haben") => data.rows.reduce((sum, r) => sum + r[key], 0);
  const toggle = (klasse: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(klasse)) next.delete(klasse);
      else next.add(klasse);
      return next;
    });

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

      <div className="kpi-grid" aria-label="Kennzahlen">
        <Kpi label="Bank" value={k.bank} hint={`laut Buchungen am ${formatDate(until)}`} />
        <Kpi label="Offene Forderungen" value={k.forderungen} hint="Rechnungen noch nicht bezahlt" />
        <Kpi label="Offene Verbindlichkeiten" value={k.verbindlichkeiten} hint="Belege noch nicht bezahlt" />
        <Kpi label={k.umsatzsteuer >= 0 ? "Umsatzsteuer-Zahllast" : "Umsatzsteuer-Erstattung"} value={Math.abs(k.umsatzsteuer)} hint="fällig, nach Vorsteuer und Vorauszahlungen" />
        <Kpi label="Erlöse − Aufwand" value={k.ertraege - k.aufwand} hint={`${formatEuro(k.ertraege)} − ${formatEuro(k.aufwand)} im Zeitraum`} />
      </div>

      <section className="card" aria-label="Saldenliste">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <p className="small muted" style={{ margin: 0, maxWidth: 640 }}>
            {formatDate(data.from)} bis {formatDate(until)}. Erlöse und Aufwand als Betrag, Bestandskonten mit Guthaben oder Schuld; S und H
            zeigen die Buchhaltungsseite. Eröffnung = Saldo ab Jahresbeginn bis zum Beginn des Zeitraums, ohne Vortrag aus dem Vorjahr.
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
          <table className="report-table sticky-head stack-table">
            <thead>
              <tr>
                <th scope="col">Konto</th>
                <th scope="col">Bezeichnung</th>
                {showOpening && (
                  <th scope="col" className="num">
                    Eröffnung
                  </th>
                )}
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
            {groups.map((g) => {
              const open = !collapsed.has(g.klasse);
              return (
                <tbody key={g.klasse}>
                  <tr className="group-row">
                    <th colSpan={cols - 3} scope="colgroup">
                      <button type="button" className="group-toggle" aria-expanded={open} onClick={() => toggle(g.klasse)}>
                        <span className={`chevron${open ? " open" : ""}`} aria-hidden="true">
                          ›
                        </span>
                        Klasse {g.klasse}
                        <span className="small muted">({g.rows.length})</span>
                      </button>
                    </th>
                    <td className="num" data-label="Soll">
                      {formatEuro(g.soll)}
                    </td>
                    <td className="num" data-label="Haben">
                      {formatEuro(g.haben)}
                    </td>
                    <td />
                  </tr>
                  {open &&
                    g.rows.map((r) => (
                      <tr key={`${r.kontenrahmen}-${r.account}`}>
                        <td className="mono" data-label="Konto">
                          <Link to="/konten/$konto" params={{ konto: r.account }} search={{ jahr: year, zeitraum }}>
                            {r.account}
                          </Link>
                        </td>
                        <td data-label="Bezeichnung">{r.name || <span className="muted">ohne Bezeichnung</span>}</td>
                        {showOpening && (
                          <td className="num" data-label="Eröffnung">
                            {r.eroeffnung ? <SaldoBetrag kontenrahmen={r.kontenrahmen} account={r.account} saldo={r.eroeffnung} /> : ""}
                          </td>
                        )}
                        <td className="num" data-label="Soll">
                          {r.soll ? formatEuro(r.soll) : ""}
                        </td>
                        <td className="num" data-label="Haben">
                          {r.haben ? formatEuro(r.haben) : ""}
                        </td>
                        <td className="num" data-label="Saldo" style={{ fontWeight: 500 }}>
                          <SaldoBetrag kontenrahmen={r.kontenrahmen} account={r.account} saldo={r.saldo} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              );
            })}
            <tfoot>
              <tr>
                <th scope="row" colSpan={cols - 3}>
                  Summe Buchungen im Zeitraum
                </th>
                <td className="num" data-label="Soll">
                  {formatEuro(total("soll"))}
                </td>
                <td className="num" data-label="Haben">
                  {formatEuro(total("haben"))}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </section>
    </>
  );
}
