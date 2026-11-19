import { formatEuro, TAX_TREATMENTS } from "@haben/core";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Icon } from "../../../components/Icon.tsx";
import { InvoiceAttachments } from "../../../components/InvoiceAttachments.tsx";
import { QuoteChoices } from "../../../components/QuoteChoices.tsx";
import { QuotePlan } from "../../../components/QuotePlan.tsx";
import { BillingStatus, QuoteStatus } from "../../../components/QuoteStatus.tsx";
import { SendMailForm } from "../../../components/SendMail.tsx";
import { formatDate, formatDateTime } from "../../../lib/format.ts";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { useAction } from "../../../lib/use-action.ts";
import { copyQuoteFn, decideQuote, type getQuoteDetail, invoiceFromQuote } from "../../../server/functions/quotes.ts";
import { OutcomeStatus } from "../../../components/Status.tsx";

export type Detail = Awaited<ReturnType<typeof getQuoteDetail>>;

export function FinalQuote({ data }: { data: Detail }) {
  const { quote, invoice, listStatus, billing } = data;
  /** Festgeschriebene, nicht stornierte Abschläge: erst dann ergibt eine Schlussrechnung Sinn */
  const finalAbschlaege = billing.filter((b) => b.variant === "abschlag" && b.status === "final" && !b.cancelled);
  const router = useRouter();
  const navigate = useNavigate();
  const decide = useServerFn(decideQuote);
  const toInvoice = useServerFn(invoiceFromQuote);
  const copy = useServerFn(copyQuoteFn);
  const { busy, notice, run } = useAction();
  // Auswahl optionaler und alternativer Positionen; fest, sobald eine Rechnung zum Angebot festgeschrieben ist
  const hasChoices = data.lines.some((l) => l.kind !== null);
  const choicesLocked = billing.some((b) => b.status === "final" && !b.cancelled);
  const [chosen, setChosen] = useState<number[]>(data.choices);
  const choicesChanged = chosen.length !== data.choices.length || chosen.some((p) => !data.choices.includes(p));
  /** Auswahl, die mit Annahme und Rechnung gespeichert wird; null = unverändert lassen */
  const choices = hasChoices && !choicesLocked ? chosen : null;

  const setDecision = (decision: "angenommen" | "abgelehnt" | null) =>
    run(async () => {
      await decide({ data: { id: quote.id, decision, choices: decision === "angenommen" ? choices : null } });
      await router.invalidate();
    });

  const onInvoice = (variant: "abschlag" | "schluss" | null = null) =>
    run(async () => {
      const created = await toInvoice({ data: { id: quote.id, variant, choices } });
      await navigate({ to: "/rechnungen/$id", params: { id: created.id } });
    });

  const onPlanRow = (planRow: number) =>
    run(async () => {
      const created = await toInvoice({ data: { id: quote.id, variant: "abschlag", choices, planRow } });
      await navigate({ to: "/rechnungen/$id", params: { id: created.id } });
    });

  const onCopy = () =>
    run(async () => {
      const created = await copy({ data: quote.id });
      await navigate({ to: "/angebote/$id", params: { id: created.id } });
    });

  return (
    <>
      <QuoteHead data={data} busy={busy} onCopy={onCopy} />

      <NoticeBanner notice={notice} />

      <div className="grid-main">
        <section aria-label="PDF">
          <iframe className="pdf-frame" src={`/api/angebot/${quote.id}#view=Fit`} title={`PDF des Angebots ${quote.number}`} />
          <a className="btn pdf-open" href={`/api/angebot/${quote.id}`} target="_blank" rel="noreferrer">
            PDF öffnen
          </a>
        </section>
        <div className="stack">
          <AnswerCard data={data} finalAbschlaege={finalAbschlaege} busy={busy} setDecision={setDecision} onInvoice={onInvoice} />

          {hasChoices && (
            <>
              <QuoteChoices
                lines={data.lines.map((l) => ({ position: l.position, description: l.description, kind: l.kind, net: l.net }))}
                chosen={chosen}
                onChange={setChosen}
                locked={choicesLocked}
              />
              {quote.decision === "angenommen" && !invoice && !choicesLocked && choicesChanged && (
                <div className="actions">
                  <button type="button" className="btn" onClick={() => void setDecision("angenommen")} disabled={busy}>
                    Auswahl speichern
                  </button>
                </div>
              )}
            </>
          )}

          {data.plan && (
            <QuotePlan
              plan={data.plan}
              taxed={quote.taxTreatment === "regulaer"}
              canBill={quote.decision !== "abgelehnt" && !invoice}
              busy={busy}
              onAbschlag={(row) => void onPlanRow(row)}
              onSchluss={() => void onInvoice("schluss")}
            />
          )}

          {billing.length > 0 && <BillingCard billing={billing} gross={quote.gross} />}

          <FactsCard quote={quote} />

          <InvoiceAttachments kind="angebot" ownerId={quote.id} attachments={data.attachments} editable={false} />

          <MailCard quote={quote} mails={data.mails} />

          <div className="banner banner-info">
            <Icon name="info" />
            <span>Angebote werden nicht gebucht. Als Handelsbrief bleibt das PDF unverändert und steht im Jahresarchiv.</span>
          </div>
        </div>
      </div>
    </>
  );
}

/** Rechnungen, die zu dem Angebot gehören, mit der Summe der Abschläge */
function BillingCard({ billing, gross }: { billing: Detail["billing"]; gross: number }) {
  const finalAbschlaege = billing.filter((b) => b.variant === "abschlag" && b.status === "final" && !b.cancelled);
  return (
    <section className="card" aria-labelledby="billing-heading">
      <h2 id="billing-heading">Rechnungen zu diesem Angebot</h2>
      {billing.map((b) => (
        <div key={b.id} className="history-row">
          <span style={{ minWidth: 0 }}>
            <Link to="/rechnungen/$id" params={{ id: b.id }}>
              {b.variant === "abschlag" ? "Abschlagsrechnung" : b.variant === "schluss" ? "Schlussrechnung" : "Rechnung"} {b.number ?? "(Entwurf)"}
            </Link>
            <span className="small muted" style={{ display: "block" }}>
              {formatDate(b.issueDate)} · <span className="amount">{formatEuro(b.gross)}</span>
            </span>
          </span>
          <BillingStatus cancelled={b.cancelled} final={b.status === "final"} />
        </div>
      ))}
      {finalAbschlaege.length > 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          Abgerechnet in Abschlägen: {formatEuro(finalAbschlaege.reduce((s, b) => s + b.gross, 0))} von {formatEuro(gross)}
        </p>
      )}
    </section>
  );
}

/** Angaben des festgeschriebenen Angebots */
function FactsCard({ quote }: { quote: Detail["quote"] }) {
  const buyer = quote.buyer as { name: string } | null;
  return (
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
        <dd className="amount">{formatEuro(quote.net)}</dd>
        <dt>Umsatzsteuer</dt>
        <dd className="amount">{formatEuro(quote.tax)}</dd>
        <dt>Brutto</dt>
        <dd className="amount" style={{ fontWeight: 600 }}>
          {formatEuro(quote.gross)}
        </dd>
        {quote.priceMode === "brutto" && (
          <>
            <dt>Preise</dt>
            <dd>brutto, inklusive Umsatzsteuer</dd>
          </>
        )}
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
  );
}

/** Versandhistorie und Formular zum (erneuten) Versenden des Angebots */
function MailCard({ quote, mails }: { quote: Detail["quote"]; mails: Detail["mails"] }) {
  const router = useRouter();
  const [mailing, setMailing] = useState(false);
  const [mailNotice, setMailNotice] = useState<string | null>(null);
  return (
    <section className="card" aria-labelledby="mail-heading">
      <h2 id="mail-heading">Per E-Mail</h2>
      {mails.length > 0 ? (
        mails.map((m) => (
          <div key={m.id} className="history-row">
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              An {m.recipient}
              <span className="small muted" style={{ display: "block" }}>
                {formatDateTime(m.createdAt)}
                {!m.ok && ` · ${m.error}`}
              </span>
              {m.attachments.length > 0 && (
                <span className="small muted" style={{ display: "block" }}>
                  Anhang: {m.attachments.join(", ")}
                </span>
              )}
            </span>
            <OutcomeStatus ok={m.ok}>{m.ok ? "Gesendet" : "Fehlgeschlagen"}</OutcomeStatus>
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
            {mails.some((m) => m.ok) ? "Erneut senden" : "Angebot senden"}
          </button>
        </div>
      )}
    </section>
  );
}

/** Kopf der Seite: Überschrift mit Status, PDF-Download und Kopieren */
function QuoteHead({ data, busy, onCopy }: { data: Detail; busy: boolean; onCopy: () => void }) {
  const { quote, invoice, listStatus } = data;
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">
          <Link to="/angebote">Angebote</Link> › Angebot
        </div>
        {/* Status neben der Überschrift wie bei der Rechnung: bleibt mit dem stehenden Kopf sichtbar */}
        <div className="title-with-status">
          <h1>Angebot {quote.number}</h1>
          <QuoteStatus quote={{ listStatus, validUntil: quote.validUntil, invoiceNumber: invoice?.number ?? null }} />
        </div>
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
  );
}

/** Antwort des Kunden: Status, zurücknehmen, Rechnung oder Belege aus der Annahme erstellen */
function AnswerCard({
  data,
  finalAbschlaege,
  busy,
  setDecision,
  onInvoice,
}: {
  data: Detail;
  finalAbschlaege: Detail["billing"];
  busy: boolean;
  setDecision: (decision: "angenommen" | "abgelehnt" | null) => void;
  onInvoice: (variant?: "abschlag" | "schluss" | null) => void;
}) {
  const { quote, invoice, listStatus } = data;
  return (
    <section className="card" aria-labelledby="answer-heading">
      <h2 id="answer-heading">
        Antwort des Kunden <QuoteStatus inline quote={{ listStatus, validUntil: quote.validUntil }} />
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
            {quote.decision !== null && (
              <button type="button" className="btn" onClick={() => void setDecision(null)} disabled={busy}>
                Antwort zurücknehmen
              </button>
            )}
            {quote.decision !== "abgelehnt" && (
              <>
                <button type="button" className="btn" onClick={() => void onInvoice("abschlag")} disabled={busy}>
                  Abschlagsrechnung erstellen
                </button>
                {finalAbschlaege.length > 0 ? (
                  <button type="button" className="btn btn-primary" onClick={() => void onInvoice("schluss")} disabled={busy}>
                    Schlussrechnung erstellen
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={() => void onInvoice()} disabled={busy}>
                    Rechnung erstellen
                  </button>
                )}
              </>
            )}
            {quote.decision === null && (
              <div className="actions" style={{ flexBasis: "100%", alignItems: "center", gap: 8 }}>
                <span className="small muted">Nur markieren:</span>
                <button type="button" className="btn btn-sm" onClick={() => void setDecision("angenommen")} disabled={busy}>
                  Angenommen
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => void setDecision("abgelehnt")} disabled={busy}>
                  Abgelehnt
                </button>
              </div>
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
  );
}
