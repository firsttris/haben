import { describeExchangeRate, DUNNING_LEVELS, formatEuro, TAX_TREATMENTS, type DunningLevel } from "@haben/core";
import { Link, useNavigate, useRouter, getRouteApi } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { InvoiceStatus } from "../../../components/InvoiceStatus.tsx";
import { LockedAndArchived } from "../../../components/ArchiveStatus.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { InvoiceAttachments } from "../../../components/InvoiceAttachments.tsx";
import { InvoiceCopyButton } from "../../../components/InvoiceCopyButton.tsx";
import { RechnungVerrechnung } from "../../../components/RechnungVerrechnung.tsx";
import { SendMailForm } from "../../../components/SendMail.tsx";
import { formatDate, formatDateTime } from "../../../lib/format.ts";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { useAction } from "../../../lib/use-action.ts";
import { FORMAT_LABEL } from "../../../lib/invoice.ts";
import { legacySource } from "../../../lib/altbestand.ts";
import { cancelFinalInvoice, correctFinalInvoice } from "../../../server/functions/invoices.ts";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { OutcomeStatus } from "../../../components/Status.tsx";
import { Payments, WriteOffs } from "./-rechnung-zahlungen.tsx";
import { type Detail, titleOf } from "./-rechnung-daten.ts";
import { Korrekturen } from "./-rechnung-korrekturen.tsx";

const route = getRouteApi("/_app/rechnungen/$id");

export function FinalInvoice({ data }: { data: Detail }) {
  const { invoice, corrects, correctedBy } = data;
  // Die Steuerberatung sieht die Rechnung, ändert und versendet aber nichts
  const inhaber = route.useRouteContext().user.role === "inhaber";
  const router = useRouter();
  const navigate = useNavigate();
  const cancel = useServerFn(cancelFinalInvoice);
  const correct = useServerFn(correctFinalInvoice);
  const { busy, notice, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  /** Was gerade per E-Mail versendet wird: die Rechnung oder eine Mahnung */
  const [mailing, setMailing] = useState<{ kind: "rechnung" | "mahnung"; id: string } | null>(null);
  const [mailNotice, setMailNotice] = useState<string | null>(null);
  const buyer = invoice.buyer as { name: string } | null;
  const mailDone = (message: string) => {
    setMailing(null);
    setMailNotice(message);
    void router.invalidate();
  };
  const cancelled = correctedBy.find((c) => c.kind === "storno" && c.status === "final");
  const canAmend = inhaber && invoice.kind === "rechnung" && !cancelled;

  const cancelNow = () => {
    void run(async () => {
      const storno = await cancel({ data: invoice.id });
      await router.invalidate();
      await navigate({ to: "/rechnungen/$id", params: { id: storno.id } });
    });
  };

  const onCorrect = () =>
    run(async () => {
      const draft = await correct({ data: invoice.id });
      await navigate({ to: "/rechnungen/$id", params: { id: draft.id } });
    });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/rechnungen">Rechnungen</Link> › {titleOf(invoice)}
          </div>
          {/* Status neben, nicht in der Überschrift: der Titel bleibt „Rechnung 2026-001“ */}
          <div className="title-with-status">
            <h1>
              {titleOf(invoice)} {invoice.number}
            </h1>
            {data.statusFacts && <InvoiceStatus invoice={data.statusFacts} />}
          </div>
        </div>
        <div className="actions">
          <a className="btn" href={`/api/rechnung/${invoice.id}/pdf?download`}>
            PDF herunterladen
          </a>
          {invoice.hasXml && (
            <a className="btn" href={`/api/rechnung/${invoice.id}/xml?download`}>
              XML herunterladen
            </a>
          )}
          {inhaber && invoice.kind === "rechnung" && (
            <a className="btn" href={`/api/dokument/lieferschein-rechnung/${invoice.id}`} target="_blank" rel="noreferrer">
              Lieferschein
            </a>
          )}
          {inhaber && <InvoiceCopyButton invoice={invoice} action={{ busy, run }} />}
        </div>
      </div>

      {cancelled && (
        <div className="banner banner-danger" role="status">
          <Icon name="alert" />
          <span>
            Storniert durch{" "}
            <Link to="/rechnungen/$id" params={{ id: cancelled.id }}>
              Stornorechnung {cancelled.number}
            </Link>
            .
          </span>
        </div>
      )}
      {data.leistungsmonat && (
        <div className="banner banner-warn" role="status">
          <Icon name="alert" />
          <span>{data.leistungsmonat}</span>
        </div>
      )}
      <NoticeBanner notice={notice} />

      <div className="grid-main">
        <section aria-label="PDF">
          <iframe className="pdf-frame" src={`/api/rechnung/${invoice.id}/pdf#view=Fit`} title={`PDF der Rechnung ${invoice.number}`} />
          <a className="btn pdf-open" href={`/api/rechnung/${invoice.id}/pdf`} target="_blank" rel="noreferrer">
            PDF öffnen
          </a>
        </section>
        <div className="stack">
          <section className="card" aria-labelledby="facts-heading">
            <h2 id="facts-heading">Angaben</h2>
            <dl className="facts">
              <dt>Kunde</dt>
              <dd>{buyer?.name ?? "–"}</dd>
              <dt>Rechnungsdatum</dt>
              <dd>{formatDate(invoice.issueDate)}</dd>
              {invoice.kind === "rechnung" && (
                <>
                  {invoice.paymentMethod === "bereits_bezahlt" && invoice.paidOn ? (
                    <>
                      <dt>Bezahlt am</dt>
                      <dd>{formatDate(invoice.paidOn)}</dd>
                      <dt>Bezahlt über</dt>
                      <dd>{invoice.paidVia}</dd>
                    </>
                  ) : (
                    <>
                      <dt>Fällig</dt>
                      <dd>{formatDate(invoice.dueDate)}</dd>
                    </>
                  )}
                </>
              )}
              <dt>Netto</dt>
              <dd className="amount">{formatEuro(invoice.net)}</dd>
              <dt>Umsatzsteuer</dt>
              <dd className="amount">{formatEuro(invoice.tax)}</dd>
              <dt>Brutto</dt>
              <dd className="amount" style={{ fontWeight: 600 }}>
                {formatEuro(invoice.gross)}
              </dd>
              {invoice.currency !== "EUR" && (
                <>
                  <dt>Währung</dt>
                  <dd>
                    Rechnung in {invoice.currency}; Beträge oben in Euro, gebucht mit{" "}
                    {invoice.exchangeRate
                      ? describeExchangeRate(invoice.currency, invoice.exchangeRate, invoice.exchangeRateSource, invoice.exchangeRateDate)
                      : "–"}
                  </dd>
                </>
              )}
              {invoice.priceMode === "brutto" && (
                <>
                  <dt>Preise</dt>
                  <dd>brutto, inklusive Umsatzsteuer</dd>
                </>
              )}
              <dt>Format</dt>
              <dd>
                {data.importSource
                  ? `Original aus ${legacySource(data.importSource.source, data.importSource.sourceName).name}`
                  : invoice.lexofficeVoucherId
                    ? "Übernommenes Original"
                    : FORMAT_LABEL[invoice.format]}
              </dd>
              {invoice.taxTreatment !== "regulaer" && (
                <>
                  <dt>Umsatzsteuer</dt>
                  <dd>{TAX_TREATMENTS[invoice.taxTreatment].label}</dd>
                </>
              )}
              <LockedAndArchived lockedAt={invoice.lockedAt} ablage={data.ablage} />
              {data.deducts.length > 0 && (
                <>
                  <dt>Abgezogen</dt>
                  <dd>
                    {data.deducts.map((d, i) => (
                      <span key={d.id}>
                        {i > 0 && ", "}
                        <Link to="/rechnungen/$id" params={{ id: d.id }}>
                          {d.number}
                        </Link>
                      </span>
                    ))}
                  </dd>
                </>
              )}
              {invoice.variant === "abschlag" && (
                <>
                  <dt>Schlussrechnung</dt>
                  <dd>
                    {data.deductedIn.length > 0 ? (
                      data.deductedIn.map((d) => (
                        <Link key={d.id} to="/rechnungen/$id" params={{ id: d.id }}>
                          {d.number ?? "Entwurf"}
                        </Link>
                      ))
                    ) : cancelled ? (
                      "–"
                    ) : (
                      <Link to="/rechnungen/neu" search={{ schluss: invoice.id }}>
                        Schlussrechnung erstellen
                      </Link>
                    )}
                  </dd>
                </>
              )}
              {data.fromQuote && (
                <>
                  <dt>{invoice.variant ? "Zum Angebot" : "Aus Angebot"}</dt>
                  <dd>
                    <Link to="/angebote/$id" params={{ id: data.fromQuote.id }}>
                      {data.fromQuote.number}
                    </Link>
                  </dd>
                </>
              )}
              {corrects && (
                <>
                  <dt>Bezieht sich auf</dt>
                  <dd>
                    <Link to="/rechnungen/$id" params={{ id: corrects.id }}>
                      Rechnung {corrects.number}
                    </Link>
                  </dd>
                </>
              )}
            </dl>
            <p className="small muted" style={{ margin: 0, overflowWrap: "anywhere" }}>
              SHA-256 PDF {invoice.pdfSha256?.slice(0, 16)}…
            </p>
          </section>

          <InvoiceAttachments ownerId={invoice.id} attachments={data.attachments} editable={false} />

          <section className="card" aria-labelledby="mail-heading">
            <h2 id="mail-heading">Per E-Mail</h2>
            {data.mails.length > 0 ? (
              data.mails.map((m) => (
                <div key={m.id} className="history-row">
                  <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                    {m.kind === "mahnung" ? "Mahnung" : titleOf(invoice)} an {m.recipient}
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
            {!inhaber ? null : mailing?.kind === "rechnung" ? (
              <SendMailForm kind="rechnung" id={invoice.id} onDone={mailDone} />
            ) : (
              <div className="actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setMailNotice(null);
                    setMailing({ kind: "rechnung", id: invoice.id });
                  }}
                >
                  {data.mails.some((m) => m.kind === "rechnung" && m.ok) ? "Erneut senden" : `${titleOf(invoice)} senden`}
                </button>
              </div>
            )}
          </section>

          {(data.dunnings.length > 0 || data.overdue) && (
            <section className="card" aria-labelledby="dunning-heading">
              <h2 id="dunning-heading">Mahnungen</h2>
              {data.dunnings.map((d) => (
                <div key={d.id} className="history-row">
                  <a href={`/api/mahnung/${d.id}`} target="_blank" rel="noreferrer">
                    {DUNNING_LEVELS[d.level as DunningLevel].label} vom {formatDate(d.date)}
                  </a>
                  <span className="small muted">
                    {formatEuro(d.total)} bis {formatDate(d.dueDate)}{" "}
                    {inhaber && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => {
                          setMailNotice(null);
                          setMailing({ kind: "mahnung", id: d.id });
                        }}
                      >
                        per E-Mail
                      </button>
                    )}
                  </span>
                </div>
              ))}
              {mailing?.kind === "mahnung" && <SendMailForm key={mailing.id} kind="mahnung" id={mailing.id} onDone={mailDone} />}
              {inhaber && data.overdue && (
                <div className="actions">
                  <Link to="/rechnungen/mahnwesen/$id" params={{ id: invoice.id }} className="btn">
                    {data.dunnings.length === 0 ? "Zahlungserinnerung erstellen" : "Nächste Mahnstufe"}
                  </Link>
                </div>
              )}
            </section>
          )}

          {inhaber && (data.payments.length > 0 || (data.open > 0 && invoice.kind !== "storno")) && (
            <Payments invoiceId={invoice.id} payments={data.payments} open={data.open} cashable={invoice.kind !== "storno" && invoice.currency === "EUR"} />
          )}

          {inhaber && invoice.kind !== "storno" && (data.open > 0 || data.writeOffs.length > 0) && (
            <WriteOffs invoiceId={invoice.id} open={data.open} writeOffs={data.writeOffs} today={data.today} />
          )}

          {invoice.status === "final" && invoice.kind !== "storno" && <RechnungVerrechnung invoiceId={invoice.id} readOnly={!inhaber} />}

          {correctedBy.length > 0 && <Korrekturen correctedBy={correctedBy} />}

          {canAmend && (
            <section className="card" aria-labelledby="amend-heading">
              <h2 id="amend-heading">Korrigieren</h2>
              <p className="small muted" style={{ margin: 0 }}>
                Festgeschriebene Rechnungen bleiben unverändert. Eine Stornorechnung hebt sie vollständig auf, eine Rechnungskorrektur mindert den Betrag
                teilweise.
              </p>
              <ConfirmDialog
                open={confirming}
                title="Rechnung stornieren?"
                facts={[
                  { label: "Nummer", value: invoice.number ?? "–" },
                  ...(buyer ? [{ label: "Kunde", value: buyer.name }] : []),
                  { label: "Betrag", value: formatEuro(invoice.gross), strong: true },
                ]}
                confirmLabel="Stornieren"
                danger
                onConfirm={cancelNow}
                onClose={() => setConfirming(false)}
              >
                <p>Es wird sofort eine Stornorechnung mit neuer Nummer erzeugt und gebucht.</p>
              </ConfirmDialog>
              <div className="actions">
                <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)} disabled={busy}>
                  Stornieren
                </button>
                <button type="button" className="btn" onClick={onCorrect} disabled={busy}>
                  Rechnungskorrektur anlegen
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
