import { formatEuro, TAX_TREATMENTS, type UnitLabel } from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Icon } from "../../../components/Icon.tsx";
import { InvoiceEditor } from "../../../components/InvoiceEditor.tsx";
import { QuoteStatus } from "../../../components/QuoteStatus.tsx";
import { SendMailForm } from "../../../components/SendMail.tsx";
import { formatDate, formatDateTime } from "../../../lib/format.ts";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { useAction } from "../../../lib/use-action.ts";
import { copyQuoteFn, decideQuote, getQuoteDetail, invoiceFromQuote } from "../../../server/functions/quotes.ts";

export const Route = createFileRoute("/_app/angebote/$id")({
  loader: ({ params }) => getQuoteDetail({ data: params.id }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.quote.number ? `Angebot ${loaderData.quote.number}` : "Angebotsentwurf"} · Haben` }],
  }),
  component: QuotePage,
});

type Detail = Awaited<ReturnType<typeof getQuoteDetail>>;

function QuotePage() {
  const data = Route.useLoaderData();
  const { quote } = data;
  if (quote.status === "draft") {
    return (
      <InvoiceEditor
        key={`${quote.id}-${String(quote.updatedAt)}`}
        id={quote.id}
        kind="angebot"
        initial={{
          contactId: quote.contactId,
          issueDate: quote.issueDate,
          validUntil: quote.validUntil,
          serviceFrom: quote.serviceFrom,
          serviceTo: quote.serviceTo,
          paymentTermDays: 0,
          format: "zugferd",
          note: quote.note,
          taxTreatment: quote.taxTreatment,
          exemptionReason: quote.exemptionReason,
          language: quote.language,
          lines: data.lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unit: line.unit as UnitLabel,
            unitPrice: line.unitPrice,
            taxRate: line.taxRate as 1900 | 700 | 0,
          })),
        }}
        contacts={data.contacts}
        seller={data.company}
        sellerIssues={data.sellerIssues}
        issues={data.issues}
        numberCounters={data.numberCounters}
        corrects={null}
        bundesland={data.bundesland}
        kleinunternehmer={data.kleinunternehmer}
        articles={data.articles}
      />
    );
  }
  return <FinalQuote data={data} />;
}

function FinalQuote({ data }: { data: Detail }) {
  const { quote, invoice, listStatus } = data;
  const router = useRouter();
  const navigate = useNavigate();
  const decide = useServerFn(decideQuote);
  const toInvoice = useServerFn(invoiceFromQuote);
  const copy = useServerFn(copyQuoteFn);
  const { busy, notice, run } = useAction();
  const [mailing, setMailing] = useState(false);
  const [mailNotice, setMailNotice] = useState<string | null>(null);
  const buyer = quote.buyer as { name: string } | null;

  const setDecision = (decision: "angenommen" | "abgelehnt" | null) =>
    run(async () => {
      await decide({ data: { id: quote.id, decision } });
      await router.invalidate();
    });

  const onInvoice = () =>
    run(async () => {
      const created = await toInvoice({ data: quote.id });
      await navigate({ to: "/rechnungen/$id", params: { id: created.id } });
    });

  const onCopy = () =>
    run(async () => {
      const created = await copy({ data: quote.id });
      await navigate({ to: "/angebote/$id", params: { id: created.id } });
    });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/angebote">Angebote</Link> › Angebot
          </div>
          <h1>Angebot {quote.number}</h1>
        </div>
        <div className="actions">
          <a className="btn" href={`/api/angebot/${quote.id}?download`}>
            PDF herunterladen
          </a>
          <button type="button" className="btn" onClick={() => void onCopy()} disabled={busy}>
            Kopieren
          </button>
        </div>
      </div>

      <NoticeBanner notice={notice} />

      <div className="grid-main">
        <section aria-label="PDF">
          <iframe className="pdf-frame" src={`/api/angebot/${quote.id}`} title={`PDF des Angebots ${quote.number}`} />
          <a className="btn pdf-open" href={`/api/angebot/${quote.id}`} target="_blank" rel="noreferrer">
            PDF öffnen
          </a>
        </section>
        <div className="stack">
          <section className="card" aria-labelledby="answer-heading">
            <h2 id="answer-heading">
              Antwort des Kunden <QuoteStatus status={listStatus} />
            </h2>
            {invoice ? (
              <p style={{ margin: 0 }}>
                Abgerechnet mit{" "}
                <Link to="/rechnungen/$id" params={{ id: invoice.id }}>
                  {invoice.number ? `Rechnung ${invoice.number}` : "einem Rechnungsentwurf"}
                </Link>
                .
              </p>
            ) : (
              <>
                <p className="small muted" style={{ margin: 0 }}>
                  {listStatus === "abgelaufen"
                    ? `Das Angebot ist seit dem ${formatDate(quote.validUntil)} abgelaufen. Nimmt der Kunde trotzdem an, kannst du es weiter abrechnen.`
                    : listStatus === "abgelehnt"
                      ? "Als abgelehnt markiert."
                      : "Nimmt der Kunde an, entsteht aus dem Angebot ein Rechnungsentwurf mit denselben Positionen, den du vor dem Festschreiben noch anpassen kannst."}
                </p>
                <div className="actions" style={{ flexWrap: "wrap" }}>
                  {quote.decision !== "abgelehnt" && (
                    <button type="button" className="btn btn-primary" onClick={() => void onInvoice()} disabled={busy}>
                      Rechnung erstellen
                    </button>
                  )}
                  {quote.decision === null && (
                    <>
                      <button type="button" className="btn" onClick={() => void setDecision("angenommen")} disabled={busy}>
                        Angenommen
                      </button>
                      <button type="button" className="btn btn-danger" onClick={() => void setDecision("abgelehnt")} disabled={busy}>
                        Abgelehnt
                      </button>
                    </>
                  )}
                  {quote.decision !== null && (
                    <button type="button" className="btn" onClick={() => void setDecision(null)} disabled={busy}>
                      Antwort zurücknehmen
                    </button>
                  )}
                </div>
              </>
            )}
            {quote.decision === "angenommen" && (
              <div className="actions" style={{ flexWrap: "wrap" }}>
                <a className="btn btn-sm" href={`/api/dokument/auftragsbestaetigung/${quote.id}`} target="_blank" rel="noreferrer">
                  Auftragsbestätigung (PDF)
                </a>
                <a className="btn btn-sm" href={`/api/dokument/lieferschein-angebot/${quote.id}`} target="_blank" rel="noreferrer">
                  Lieferschein (PDF)
                </a>
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="facts-heading">
            <h2 id="facts-heading">Angaben</h2>
            <dl className="facts">
              <dt>Kunde</dt>
              <dd>{buyer?.name ?? "–"}</dd>
              <dt>Angebotsdatum</dt>
              <dd>{formatDate(quote.issueDate)}</dd>
              <dt>Gültig bis</dt>
              <dd>{formatDate(quote.validUntil)}</dd>
              <dt>Netto</dt>
              <dd className="mono">{formatEuro(quote.net)}</dd>
              <dt>Umsatzsteuer</dt>
              <dd className="mono">{formatEuro(quote.tax)}</dd>
              <dt>Brutto</dt>
              <dd className="mono" style={{ fontWeight: 600 }}>
                {formatEuro(quote.gross)}
              </dd>
              {quote.taxTreatment !== "regulaer" && (
                <>
                  <dt>Besteuerung</dt>
                  <dd>{TAX_TREATMENTS[quote.taxTreatment].label}</dd>
                </>
              )}
              <dt>Festgeschrieben</dt>
              <dd>{quote.lockedAt ? formatDateTime(quote.lockedAt) : "–"}</dd>
              {quote.decidedAt && (
                <>
                  <dt>Antwort</dt>
                  <dd>{formatDateTime(quote.decidedAt)}</dd>
                </>
              )}
            </dl>
          </section>

          <section className="card" aria-labelledby="mail-heading">
            <h2 id="mail-heading">Per E-Mail</h2>
            {data.mails.length > 0 ? (
              data.mails.map((m) => (
                <div key={m.id} className="history-row">
                  <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                    An {m.recipient}
                    <span className="small muted" style={{ display: "block" }}>
                      {formatDateTime(m.createdAt)}
                      {!m.ok && ` · ${m.error}`}
                    </span>
                  </span>
                  <span className={`pill ${m.ok ? "pill-ok" : "pill-danger"}`}>{m.ok ? "Gesendet" : "Fehlgeschlagen"}</span>
                </div>
              ))
            ) : (
              <p className="small muted" style={{ margin: 0 }}>
                Noch nicht per E-Mail versendet.
              </p>
            )}
            {mailNotice && (
              <div className="banner banner-ok" role="status">
                {mailNotice}
              </div>
            )}
            {mailing ? (
              <SendMailForm
                kind="angebot"
                id={quote.id}
                onDone={(message) => {
                  setMailing(false);
                  setMailNotice(message);
                  void router.invalidate();
                }}
              />
            ) : (
              <div className="actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setMailNotice(null);
                    setMailing(true);
                  }}
                >
                  {data.mails.some((m) => m.ok) ? "Erneut senden" : "Angebot senden"}
                </button>
              </div>
            )}
          </section>

          <div className="banner banner-info">
            <Icon name="info" />
            <span>Angebote werden nicht gebucht. Als Handelsbrief bleibt das PDF unverändert und steht im Jahresarchiv.</span>
          </div>
        </div>
      </div>
    </>
  );
}
