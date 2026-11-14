import { formatEuro, parseEuroSearchCents } from "@haben/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod/mini";
import { Field } from "../../../components/Field.tsx";
import { InvoiceTabs } from "../../../components/InvoiceTabs.tsx";
import { InvoiceStatus } from "../../../components/InvoiceStatus.tsx";
import { formatDate } from "../../../lib/format.ts";
import { VARIANT_TITLE } from "../../../lib/invoice.ts";
import { getInvoices } from "../../../server/functions/invoices.ts";
import { Icon } from "../../../components/Icon.tsx";

export const Route = createFileRoute("/_app/rechnungen/")({
  validateSearch: z.object({ suche: z.optional(z.string()) }),
  loader: () => getInvoices(),
  head: () => ({ meta: [{ title: "Rechnungen · Haben" }] }),
  component: InvoicesPage,
});

function InvoicesPage() {
  const invoices = Route.useLoaderData();
  const inhaber = Route.useRouteContext().user.role === "inhaber";
  const { suche } = Route.useSearch();
  const [query, setQuery] = useState(suche ?? "");
  useEffect(() => {
    setQuery(suche ?? "");
  }, [suche]);
  const needle = query.trim().toLowerCase();
  const cents = parseEuroSearchCents(query);
  const shown = needle
    ? invoices.filter(
        (invoice) =>
          invoice.gross === cents ||
          [invoice.number, invoice.customer, invoice.contactName, invoice.buyerOrderReference, invoice.sellerOrderReference].some((v) =>
            v?.toLowerCase().includes(needle),
          ),
      )
    : invoices;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Verkauf</div>
          <h1>Rechnungen</h1>
        </div>
        {inhaber && (
          <div className="actions">
            <Link to="/rechnungen/neu" className="btn btn-primary">
              Neue Rechnung
            </Link>
          </div>
        )}
      </div>
      {/* Wiederkehrend und Mahnwesen sind Arbeit des Inhabers */}
      {inhaber && <InvoiceTabs />}
      {invoices.length > 0 && (
        <div className="filter-row" style={{ marginBottom: 0 }}>
          <Field label="Rechnungen durchsuchen" hideLabel style={{ flex: "1 1 260px", maxWidth: 420 }}>
            {(control) => <input {...control} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Suchen: Nummer oder Kunde" />}
          </Field>
        </div>
      )}
      <section className="card" aria-label="Rechnungsliste">
        {invoices.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Noch keine Rechnungen. Die erste legst du mit „Neue Rechnung“ an.
          </p>
        ) : shown.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Keine Rechnung passt zu „{query}“.
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
            {shown.map((invoice) => (
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
                  <InvoiceStatus invoice={invoice} />
                  {invoice.mailed && (
                    <span className="small muted mail-mark" title="per E-Mail versendet">
                      <Icon name="mail" size={14} />
                      <span className="visually-hidden"> per E-Mail versendet</span>
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
