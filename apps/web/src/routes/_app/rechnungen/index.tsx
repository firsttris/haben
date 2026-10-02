import { formatEuro } from "@haben/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { InvoiceStatus } from "../../../components/InvoiceStatus.tsx";
import { formatDate } from "../../../lib/format.ts";
import { getInvoices } from "../../../server/functions/invoices.ts";

export const Route = createFileRoute("/_app/rechnungen/")({
  loader: () => getInvoices(),
  head: () => ({ meta: [{ title: "Rechnungen · Haben" }] }),
  component: InvoicesPage,
});

function InvoicesPage() {
  const invoices = Route.useLoaderData();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Ausgangsrechnungen</div>
          <h1>Rechnungen</h1>
        </div>
        <div className="actions">
          <Link to="/kontakte" className="btn">
            Kontakte
          </Link>
          <Link to="/rechnungen/wiederkehrend" className="btn">
            Wiederkehrend
          </Link>
          <Link to="/rechnungen/mahnwesen" className="btn">
            Mahnwesen
          </Link>
          <Link to="/rechnungen/neu" className="btn btn-primary">
            Neue Rechnung
          </Link>
        </div>
      </div>
      <section className="card" aria-label="Rechnungsliste">
        {invoices.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Noch keine Rechnungen. Die erste legst du mit „Neue Rechnung“ an.
          </p>
        ) : (
          <div className="table">
            <div className="table-row head invoice-cols">
              <div>Nummer</div>
              <div>Kunde</div>
              <div>Datum</div>
              <div className="num">Brutto</div>
              <div>Status</div>
            </div>
            {invoices.map((invoice) => (
              <Link key={invoice.id} to="/rechnungen/$id" params={{ id: invoice.id }} className="table-row invoice-cols">
                <div className="mono small">{invoice.number ?? "–"}</div>
                <div>{invoice.customer}</div>
                <div className="muted small">{formatDate(invoice.issueDate)}</div>
                <div className="num">{formatEuro(invoice.gross)}</div>
                <div>
                  <InvoiceStatus status={invoice.listStatus} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
