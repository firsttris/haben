import { formatEuro } from "@haben/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { QuoteStatus } from "../../../components/QuoteStatus.tsx";
import { formatDate } from "../../../lib/format.ts";
import { getQuotes } from "../../../server/functions/quotes.ts";

export const Route = createFileRoute("/_app/angebote/")({
  loader: () => getQuotes(),
  head: () => ({ meta: [{ title: "Angebote · Haben" }] }),
  component: QuotesPage,
});

function QuotesPage() {
  const quotes = Route.useLoaderData();
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
          {offen.length} {offen.length === 1 ? "Angebot wartet" : "Angebote warten"} auf Antwort, zusammen{" "}
          {formatEuro(offen.reduce((s, q) => s + q.net, 0))} netto.
        </p>
      )}
      <section className="card" aria-label="Angebotsliste">
        {quotes.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Noch keine Angebote. Das erste legst du mit „Neues Angebot“ an; nimmt der Kunde an, wird daraus mit einem Klick eine Rechnung.
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
            {quotes.map((quote) => (
              <Link key={quote.id} to="/angebote/$id" params={{ id: quote.id }} className="table-row invoice-cols">
                <div className="mono small">{quote.number ?? "–"}</div>
                <div>{quote.customer}</div>
                <div className="muted small">{formatDate(quote.validUntil)}</div>
                <div className="num">{formatEuro(quote.gross)}</div>
                <div>
                  <QuoteStatus status={quote.listStatus} />
                  {quote.mailed && (
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
