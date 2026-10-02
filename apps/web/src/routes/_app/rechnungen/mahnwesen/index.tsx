import { DUNNING_LEVELS, daysOverdue, formatEuro, type DunningLevel } from "@haben/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { formatDate } from "../../../../lib/format.ts";
import { getOverdue } from "../../../../server/functions/dunning.ts";

export const Route = createFileRoute("/_app/rechnungen/mahnwesen/")({
  loader: () => getOverdue(),
  head: () => ({ meta: [{ title: "Mahnwesen · Haben" }] }),
  component: DunningPage,
});

function DunningPage() {
  const { items, today } = Route.useLoaderData();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/rechnungen">Rechnungen</Link> › Mahnwesen
          </div>
          <h1>Überfällige Rechnungen</h1>
        </div>
      </div>
      <section className="card" aria-label="Überfällige Rechnungen">
        {items.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Keine überfälligen Rechnungen. Ob eine Rechnung bezahlt ist, ergibt sich aus den Zuordnungen im Bankabgleich.
          </p>
        ) : (
          <div className="table">
            <div className="table-row head dunning-cols">
              <div>Rechnung</div>
              <div>Kunde</div>
              <div>Überfällig</div>
              <div className="num">Offen</div>
              <div>Zuletzt</div>
              <div />
            </div>
            {items.map((invoice) => (
              <div key={invoice.id} className="table-row dunning-cols">
                <div className="mono small">
                  <Link to="/rechnungen/$id" params={{ id: invoice.id }}>
                    {invoice.number}
                  </Link>
                </div>
                <div>{invoice.customer}</div>
                <div className="small">
                  {daysOverdue(invoice.dueDate, today)} Tage
                  <div className="muted">fällig {formatDate(invoice.dueDate)}</div>
                </div>
                <div className="num">{formatEuro(invoice.open)}</div>
                <div className="small">
                  {invoice.lastDunning ? (
                    <>
                      <a href={`/api/mahnung/${invoice.lastDunning.id}`} target="_blank" rel="noreferrer">
                        {DUNNING_LEVELS[invoice.lastDunning.level as DunningLevel].label}
                      </a>{" "}
                      vom {formatDate(invoice.lastDunning.date)}
                      <div className="muted">Frist bis {formatDate(invoice.lastDunning.dueDate)}</div>
                    </>
                  ) : (
                    <span className="muted">noch nicht gemahnt</span>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <Link to="/rechnungen/mahnwesen/$id" params={{ id: invoice.id }} className={invoice.waiting ? "btn" : "btn btn-primary"}>
                    {DUNNING_LEVELS[invoice.nextLevel].label}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <p className="small muted">
        Läuft die Frist der letzten Mahnung noch, ist die nächste Stufe hell dargestellt. Mahngebühr, Frist und Basiszinssatz stellst du in den{" "}
        <Link to="/einstellungen">Einstellungen</Link> ein.
      </p>
    </>
  );
}
