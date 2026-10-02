import { formatEuro, periodKey, periodLabel } from "@haben/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { daysUntil, formatDate, formatLongDate } from "../../lib/format.ts";
import { InvoiceStatus } from "../../components/InvoiceStatus.tsx";
import { getInvoiceSummary } from "../../server/functions/invoices.ts";
import { getOverview } from "../../server/functions/vat.ts";

export const Route = createFileRoute("/_app/")({
  loader: async () => {
    const [vat, invoices] = await Promise.all([getOverview(), getInvoiceSummary()]);
    return { ...vat, invoices };
  },
  head: () => ({ meta: [{ title: "Übersicht · Haben" }] }),
  component: OverviewPage,
});

interface Todo {
  title: string;
  detail: string;
  action: string;
  tone: "info" | "warn" | "neutral";
  to: "/umsatzsteuer/$zeitraum" | "/einstellungen" | "/rechnungen" | "/bank";
}

const DOT = { info: "var(--info-ink)", warn: "var(--warn-dot)", neutral: "var(--muted)" };

function OverviewPage() {
  const data = Route.useLoaderData();
  const key = periodKey(data.period);
  const sent = data.current?.status === "sent";
  const certificateDays = data.certificate?.validUntil ? daysUntil(data.certificate.validUntil) : null;

  const todos: Todo[] = [];
  if (!sent) {
    todos.push({
      title: `Voranmeldung ${periodLabel(data.period)} senden`,
      detail: `Fällig ${formatLongDate(data.dueDate)}`,
      action: "Öffnen",
      tone: daysUntil(data.dueDate) <= 3 ? "warn" : "info",
      to: "/umsatzsteuer/$zeitraum",
    });
  }
  const openBank = data.invoices.bank.reduce((sum, a) => sum + a.openCount, 0);
  if (openBank > 0) {
    todos.push({
      title: `${openBank} ${openBank === 1 ? "Bankumsatz" : "Bankumsätze"} ohne Zuordnung`,
      detail: data.invoices.bank.filter((a) => a.openCount > 0).map((a) => a.name).join(" und "),
      action: "Zuordnen",
      tone: "info",
      to: "/bank",
    });
  }
  if (data.invoices.overdueCount > 0) {
    todos.push({
      title: `${data.invoices.overdueCount} ${data.invoices.overdueCount === 1 ? "Rechnung" : "Rechnungen"} überfällig`,
      detail: "Zahlungseingang prüfen oder erinnern",
      action: "Ansehen",
      tone: "warn",
      to: "/rechnungen",
    });
  }
  if (data.invoices.drafts > 0) {
    todos.push({
      title: `${data.invoices.drafts} ${data.invoices.drafts === 1 ? "Rechnungsentwurf" : "Rechnungsentwürfe"}`,
      detail: "Noch nicht festgeschrieben",
      action: "Öffnen",
      tone: "neutral",
      to: "/rechnungen",
    });
  }
  if (data.companyIssues.length > 0) {
    todos.push({
      title: "Firmendaten vervollständigen",
      detail: data.companyIssues.join(" · "),
      action: "Ergänzen",
      tone: "warn",
      to: "/einstellungen",
    });
  }
  if (!data.certificate) {
    todos.push({
      title: "ELSTER-Zertifikat hinterlegen",
      detail: "Die .pfx-Datei aus Mein ELSTER wird zum Senden gebraucht",
      action: "Hochladen",
      tone: "neutral",
      to: "/einstellungen",
    });
  } else if (certificateDays !== null && certificateDays <= 30) {
    todos.push({
      title: certificateDays < 0 ? "ELSTER-Zertifikat abgelaufen" : "ELSTER-Zertifikat läuft bald ab",
      detail: `Gültig bis ${formatDate(data.certificate.validUntil!)}`,
      action: "Erneuern",
      tone: "warn",
      to: "/einstellungen",
    });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{formatLongDate(new Date())}</div>
          <h1>Übersicht</h1>
        </div>
        <div className="actions">
          <Link to="/umsatzsteuer/$zeitraum" params={{ zeitraum: key }} className="btn">
            Voranmeldung {periodLabel(data.period)}
          </Link>
          <Link to="/rechnungen/neu" className="btn btn-primary">
            Neue Rechnung
          </Link>
        </div>
      </div>

      {data.mode === "simuliert" && (
        <div className="banner banner-info" role="status">
          ERiC ist nicht eingerichtet (ERIC_HOME fehlt). Prüfen und Senden laufen simuliert, nichts geht an das Finanzamt.
        </div>
      )}

      <div className="grid-4">
        <div className="card">
          <div className="kpi-label">Offene Forderungen</div>
          <div className="kpi-value">{formatEuro(data.invoices.openTotal)}</div>
          <div className="small" style={{ color: data.invoices.overdueCount ? "var(--warn-ink)" : "var(--muted)" }}>
            {data.invoices.openCount} {data.invoices.openCount === 1 ? "Rechnung" : "Rechnungen"}
            {data.invoices.overdueCount ? ` · ${data.invoices.overdueCount} überfällig` : ""}
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">Umsatz {periodLabel(data.period).split(" ")[0]} (netto)</div>
          <div className="kpi-value">{formatEuro(data.invoices.revenuePreviousMonth.net)}</div>
          <div className="small muted">nach Rechnungsdatum</div>
        </div>
        <div className="card">
          <div className="kpi-label">USt-Zahllast {periodLabel(data.period)}</div>
          <div className="kpi-value">{formatEuro(data.current?.status === "sent" ? data.current.kz83 : data.computedKz83)}</div>
          <div className="small muted">
            {sent ? `gesendet ${formatDate(data.current!.sentAt!)}` : `Voranmeldung fällig ${formatDate(data.dueDate)}`}
          </div>
        </div>
        {data.invoices.bank.filter((a) => a.balance !== null).slice(0, 1).map((a) => (
          <div className="card" key={a.id}>
            <div className="kpi-label">Kontostand {a.name}</div>
            <div className="kpi-value">{formatEuro(a.balance!)}</div>
            <div className="small muted">{a.balanceDate ? `Stand letzter Import ${formatDate(a.balanceDate)}` : "Stand letzter Import"}</div>
          </div>
        ))}
        <div className="card">
          <div className="kpi-label">ELSTER-Zertifikat</div>
          <div className="kpi-value" style={{ fontSize: 18, fontFamily: "var(--sans)" }}>
            {data.certificate ? data.certificate.filename : "nicht hinterlegt"}
          </div>
          <div className="small muted">
            {data.certificate?.validUntil ? `gültig bis ${formatDate(data.certificate.validUntil)}` : "Ablaufdatum unbekannt"}
          </div>
        </div>
      </div>

      <div className="grid-main">
        <section className="card" aria-labelledby="todo-heading">
          <h2 id="todo-heading">Zu erledigen</h2>
          {todos.length === 0 ? (
            <p className="muted">Alles erledigt.</p>
          ) : (
            todos.map((todo) => (
              <Link key={todo.title} to={todo.to} params={{ zeitraum: key }} className="todo">
                <span className="todo-dot" style={{ background: DOT[todo.tone] }} />
                <span className="todo-body">
                  <span className="todo-title">{todo.title}</span>
                  <span className="small muted">{todo.detail}</span>
                </span>
                <span className="todo-action">{todo.action}</span>
              </Link>
            ))
          )}
        </section>
        <section className="card" aria-labelledby="invoices-heading">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 id="invoices-heading">Letzte Rechnungen</h2>
            <Link to="/rechnungen" className="small">
              Alle anzeigen
            </Link>
          </div>
          {data.invoices.recent.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Noch keine festgeschriebene Rechnung.</p>
          ) : (
            <div className="table">
              {data.invoices.recent.map((invoice) => (
                <Link key={invoice.id} to="/rechnungen/$id" params={{ id: invoice.id }} className="table-row invoice-cols-compact">
                  <div className="mono small">{invoice.number}</div>
                  <div title={invoice.customer}>{invoice.customer}</div>
                  <div className="num">{formatEuro(invoice.gross)}</div>
                  <div>
                    <InvoiceStatus status={invoice.listStatus} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
      <div className="grid-main">
        <section className="card" aria-labelledby="recent-heading">
          <h2 id="recent-heading">Letzte Voranmeldungen</h2>
          {data.recent.length === 0 ? (
            <p className="muted">Noch keine Voranmeldung über Haben gesendet.</p>
          ) : (
            data.recent.map((entry) => (
              <div key={entry.id} className="history-row">
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <Link to="/umsatzsteuer/$zeitraum" params={{ zeitraum: periodKey(entry) }}>
                    {periodLabel(entry)}
                    {entry.berichtigt ? " (berichtigt)" : ""}
                  </Link>
                  <span className="small muted">gesendet {formatDate(entry.sentAt!)}</span>
                </div>
                <span className="mono">{formatEuro(entry.kz83)}</span>
              </div>
            ))
          )}
        </section>
      </div>
    </>
  );
}
