import { formatEuro } from "@haben/core";
import { Link, createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { formatDate } from "../../../lib/format.ts";
import styles from "../../../styles/auswertungen.css?url";
import { getKontenblatt } from "../../../server/functions/ledger.ts";
import { Saldo, ZEITRAEUME } from "../../../components/Ledger.tsx";

export const Route = createFileRoute("/_app/konten/$konto")({
  validateSearch: z.object({
    jahr: z.number().int().optional(),
    zeitraum: z.string().regex(/^(jahr|q[1-4]|m([1-9]|1[0-2]))$/).optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) => {
    if (!/^\d{4,8}$/.test(params.konto)) throw notFound();
    return getKontenblatt({ data: { account: params.konto, year: deps.jahr ?? new Date().getFullYear(), period: deps.zeitraum ?? "jahr" } });
  },
  head: ({ params }) => ({ meta: [{ title: `Konto ${params.konto} · Haben` }], links: [{ rel: "stylesheet", href: styles }] }),
  component: KontenblattPage,
});

const SOURCE = { invoice: "Rechnung", document: "Beleg", allocation: "Bank", asset: "Anlage" } as const;

function SourceLink({ type, id, reversal }: { type: string; id: string; reversal: boolean }) {
  const label = reversal ? "Gegenbuchung" : (SOURCE[type as keyof typeof SOURCE] ?? type);
  if (type === "invoice") return <Link to="/rechnungen/$id" params={{ id }}>{label}</Link>;
  if (type === "document") return <Link to="/belege/$id" params={{ id }}>{label}</Link>;
  if (type === "asset") return <Link to="/anlagen/$id" params={{ id }}>{label}</Link>;
  if (type === "allocation") return <Link to="/bank">{label}</Link>;
  return <>{label}</>;
}

function KontenblattPage() {
  const data = Route.useLoaderData();
  const { konto } = Route.useParams();
  const deps = Route.useSearch();
  const navigate = useNavigate();
  const year = Number(data.from.slice(0, 4));
  const zeitraum = deps.zeitraum ?? "jahr";

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

      <section className="card" aria-label="Kontenblatt">
        <div style={{ overflowX: "auto" }}>
          <table className="report-table">
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
                <th scope="col" className="num">
                  Saldo
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="muted">
                <td>{formatDate(data.from)}</td>
                <td colSpan={5}>Eröffnung (Saldo ab Jahresbeginn)</td>
                <td className="num">
                  <Saldo value={data.eroeffnung} />
                </td>
              </tr>
              {data.zeilen.map((z, i) => (
                <tr key={`${z.entryId}-${i}`}>
                  <td>{formatDate(z.date)}</td>
                  <td>{z.description}</td>
                  <td className="mono small">
                    {z.gegenkonten.map((g, j) => (
                      <span key={g}>
                        {j > 0 && ", "}
                        <Link to="/konten/$konto" params={{ konto: g }} search={{ jahr: year, zeitraum }}>
                          {g}
                        </Link>
                      </span>
                    ))}
                  </td>
                  <td className="small">
                    <SourceLink type={z.sourceType} id={z.sourceId} reversal={z.reversal} />
                  </td>
                  <td className="num">{z.soll ? formatEuro(z.soll) : ""}</td>
                  <td className="num">{z.haben ? formatEuro(z.haben) : ""}</td>
                  <td className="num">
                    <Saldo value={z.saldo} />
                  </td>
                </tr>
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
              <tr style={{ fontWeight: 600 }}>
                <th scope="row" colSpan={4}>
                  Summe Zeitraum
                </th>
                <td className="num">{formatEuro(data.soll)}</td>
                <td className="num">{formatEuro(data.haben)}</td>
                <td className="num">
                  <Saldo value={data.saldo} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </>
  );
}
