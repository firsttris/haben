import { RECURRING_INTERVALS, formatEuro, lineNet, type RecurringInterval } from "@haben/core";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { formatDate } from "../../../../lib/format.ts";
import { NoticeBanner } from "../../../../components/NoticeBanner.tsx";
import { useAction } from "../../../../lib/use-action.ts";
import { getRecurringList, runRecurringNow } from "../../../../server/functions/recurring.ts";

export const Route = createFileRoute("/_app/rechnungen/wiederkehrend/")({
  loader: () => getRecurringList(),
  head: () => ({ meta: [{ title: "Wiederkehrende Rechnungen · Haben" }] }),
  component: RecurringPage,
});

function RecurringPage() {
  const { items, today } = Route.useLoaderData();
  const router = useRouter();
  const runNow = useServerFn(runRecurringNow);
  const { busy, notice, setNotice, run } = useAction();
  const due = items.filter(({ recurring }) => recurring.active && recurring.nextDate <= today).length;

  const onRun = () =>
    run(async () => {
      const result = await runNow();
      await router.invalidate();
      const text = `${result.created} ${result.created === 1 ? "Rechnung" : "Rechnungen"} angelegt, ${result.finalized} festgeschrieben.`;
      setNotice(result.errors.length ? { tone: "danger", text: `${text} ${result.errors.join(" ")}` } : { tone: "ok", text });
    });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/rechnungen">Rechnungen</Link> › Wiederkehrend
          </div>
          <h1>Wiederkehrende Rechnungen</h1>
        </div>
        <div className="actions">
          {due > 0 && (
            <button type="button" className="btn" onClick={onRun} disabled={busy}>
              {due} fällige jetzt anlegen
            </button>
          )}
          <Link to="/rechnungen/wiederkehrend/neu" className="btn btn-primary">
            Neue Vorlage
          </Link>
        </div>
      </div>
      <NoticeBanner notice={notice} />
      <section className="card" aria-label="Vorlagen">
        {items.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Noch keine Vorlage. Für Monatspauschalen, Wartungsverträge oder Hosting legt Haben die Rechnung zu jedem Termin
            automatisch an, als Entwurf oder gleich festgeschrieben.
          </p>
        ) : (
          <div className="table">
            <div className="table-row head recurring-cols">
              <div>Vorlage</div>
              <div>Kunde</div>
              <div>Intervall</div>
              <div>Nächste</div>
              <div className="num">Netto</div>
            </div>
            {items.map(({ recurring, contactName }) => (
              <Link key={recurring.id} to="/rechnungen/wiederkehrend/$id" params={{ id: recurring.id }} className="table-row recurring-cols">
                <div>
                  {recurring.name} {!recurring.active && <span className="pill">inaktiv</span>}
                  {recurring.lastError && <span className="pill pill-warn">Fehler</span>}
                  <div className="small muted">{recurring.mode === "festschreiben" ? (recurring.sendByMail ? "wird festgeschrieben und gemailt" : "wird festgeschrieben") : "als Entwurf"}</div>
                </div>
                <div>{contactName}</div>
                <div className="small">{RECURRING_INTERVALS[recurring.intervalMonths as RecurringInterval]}</div>
                <div className="small">{recurring.active ? formatDate(recurring.nextDate) : "–"}</div>
                <div className="num">{formatEuro(recurring.lines.reduce((s, l) => s + lineNet(l.quantity, l.unitPrice), 0))}</div>
              </Link>
            ))}
          </div>
        )}
      </section>
      <p className="small muted">
        Haben prüft stündlich, ob ein Termin fällig ist, und holt verpasste Termine mit ihrem Datum nach.
      </p>
    </>
  );
}
