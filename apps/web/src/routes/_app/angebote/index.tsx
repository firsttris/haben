import { formatEuro } from "@haben/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod/mini";
import { Field } from "../../../components/Field.tsx";
import { QuoteStatus } from "../../../components/QuoteStatus.tsx";
import { formatDate } from "../../../lib/format.ts";
import { getQuotes } from "../../../server/functions/quotes.ts";
import { Icon } from "../../../components/Icon.tsx";

export const Route = createFileRoute("/_app/angebote/")({
  validateSearch: z.object({ suche: z.optional(z.string()) }),
  loader: () => getQuotes(),
  head: () => ({ meta: [{ title: "Angebote · Haben" }] }),
  component: QuotesPage,
});

function QuotesPage() {
  const quotes = Route.useLoaderData();
  const { suche } = Route.useSearch();
  const [query, setQuery] = useState(suche ?? "");
  useEffect(() => {
    setQuery(suche ?? "");
  }, [suche]);
  const needle = query.trim().toLowerCase();
  const shown = needle ? quotes.filter((quote) => [quote.number, quote.customer].some((v) => v?.toLowerCase().includes(needle))) : quotes;
  const offen = quotes.filter((q) => q.listStatus === "offen");
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Vor der Rechnung</div>
          <h1>Angebote</h1>
        </div>
        <div className="actions">
          <Link to="/angebote/neu" className="btn btn-primary">
            Neues Angebot
          </Link>
        </div>
      </div>
      {offen.length > 0 && (
        <p className="muted" style={{ marginTop: 0 }}>
          {offen.length} {offen.length === 1 ? "Angebot wartet" : "Angebote warten"} auf Antwort, zusammen {formatEuro(offen.reduce((s, q) => s + q.net, 0))}{" "}
          netto.
        </p>
      )}
      {quotes.length > 0 && (
        <div className="filter-row" style={{ marginBottom: 0 }}>
          <Field label="Angebote durchsuchen" hideLabel style={{ flex: "1 1 260px", maxWidth: 420 }}>
            {(control) => <input {...control} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Suchen: Nummer oder Kunde" />}
          </Field>
        </div>
      )}
      <section className="card" aria-label="Angebotsliste">
        {quotes.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Noch keine Angebote. Das erste legst du mit „Neues Angebot“ an; nimmt der Kunde an, wird daraus mit einem Klick eine Rechnung.
          </p>
        ) : shown.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Kein Angebot passt zu „{query}“.
          </p>
        ) : (
          <div className="table">
            <div className="table-row head invoice-cols">
              <div>Nummer</div>
              <div>Kunde</div>
              <div>Gültig bis</div>
              <div className="num">Brutto</div>
              <div>Status</div>
            </div>
            {shown.map((quote) => (
              <Link key={quote.id} to="/angebote/$id" params={{ id: quote.id }} className="table-row invoice-cols">
                <div className="mono small">{quote.number ?? "–"}</div>
                <div>{quote.customer}</div>
                <div className="muted small">{formatDate(quote.validUntil)}</div>
                <div className="num">{formatEuro(quote.gross)}</div>
                <div>
                  <QuoteStatus quote={quote} />
                  {quote.mailed && (
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
