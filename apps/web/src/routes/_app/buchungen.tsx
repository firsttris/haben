import { formatEuro, periodLabel, previousPeriod, type VatPeriod } from "@haben/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { formatDate } from "../../lib/format.ts";
import { getJournal } from "../../server/functions/journal.ts";

export const Route = createFileRoute("/_app/buchungen")({
  validateSearch: z.object({ jahr: z.number().int().optional(), monat: z.number().int().min(1).max(12).optional() }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => {
    const now = new Date();
    const period = { year: deps.jahr ?? now.getFullYear(), month: deps.monat ?? now.getMonth() + 1 };
    return getJournal({ data: period }).then((entries) => ({ period, entries }));
  },
  head: () => ({ meta: [{ title: "Buchungen · Haben" }] }),
  component: JournalPage,
});

const SOURCE = { invoice: "Rechnung", document: "Beleg", allocation: "Bank", asset: "Anlage" } as const;

function nextPeriod({ year, month }: VatPeriod): VatPeriod {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

function JournalPage() {
  const { period, entries } = Route.useLoaderData();
  const prev = previousPeriod(period);
  const next = nextPeriod(period);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Journal · festgeschrieben</div>
          <h1>Buchungen {periodLabel(period)}</h1>
        </div>
        <div className="actions">
          <Link to="/buchungen" search={{ jahr: prev.year, monat: prev.month }} className="btn">
            ‹ {periodLabel(prev)}
          </Link>
          <Link to="/buchungen" search={{ jahr: next.year, monat: next.month }} className="btn">
            {periodLabel(next)} ›
          </Link>
        </div>
      </div>
      <section className="card" aria-label="Buchungen">
        {entries.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Keine Buchungen in diesem Monat.</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="journal-entry">
              <div className="journal-head">
                <span className="muted small">{formatDate(entry.date)}</span>
                <span style={{ fontWeight: 500 }}>{entry.description}</span>
                <span className="pill">{entry.reversal ? "Gegenbuchung" : SOURCE[entry.sourceType]}</span>
              </div>
              <table className="journal-lines">
                <thead className="visually-hidden">
                  <tr>
                    <th>Konto</th>
                    <th>Bezeichnung</th>
                    <th>Soll</th>
                    <th>Haben</th>
                    <th>Steuerschlüssel</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="mono">{line.account}</td>
                      <td>{line.name}</td>
                      <td className="num">{line.debit ? formatEuro(line.debit) : ""}</td>
                      <td className="num">{line.credit ? formatEuro(line.credit) : ""}</td>
                      <td className="small muted">{line.taxCode ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </section>
    </>
  );
}
