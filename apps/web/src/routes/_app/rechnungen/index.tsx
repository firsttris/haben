import { formatEuro } from "@haben/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { InvoiceStatus } from "../../../components/InvoiceStatus.tsx";
import { formatDate } from "../../../lib/format.ts";
import { VARIANT_TITLE } from "../../../lib/invoice.ts";
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
          <Link to="/rechnungen/neu" className="btn btn-primary">
            Neue Rechnung
          </Link>
        </div>
      </div>
      <nav className="subnav" aria-label="Bereiche der Rechnungen">
        <Link to="/rechnungen" className="chip active" aria-current="page">
          Alle Rechnungen
        </Link>
        <Link to="/rechnungen/wiederkehrend" className="chip">
          Wiederkehrend
        </Link>
        <Link to="/rechnungen/mahnwesen" className="chip">
          Mahnwesen
        </Link>
        <Link to="/rechnungen/artikel" className="chip">
          Artikel
        </Link>
        <Link to="/kontakte" className="chip">
          Kontakte
        </Link>
      </nav>
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
                <div>
                  {invoice.customer}
                  {invoice.variant && (
                    <span className="small muted" style={{ display: "block" }}>
                      {VARIANT_TITLE[invoice.variant]}
                    </span>
                  )}
                </div>
                <div className="muted small">{formatDate(invoice.issueDate)}</div>
                <div className="num">{formatEuro(invoice.gross)}</div>
                <div>
                  <InvoiceStatus status={invoice.listStatus} />
                  {invoice.mailed && (
                    <span className="small muted" title="per E-Mail versendet" style={{ marginLeft: 6 }}>
                      ✉<span className="visually-hidden"> per E-Mail versendet</span>
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
