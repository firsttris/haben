import { DUNNING_LEVELS, formatEuro, TAX_TREATMENTS, type DunningLevel, type UnitLabel } from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Icon } from "../../../components/Icon.tsx";
import { InvoiceEditor } from "../../../components/InvoiceEditor.tsx";
import { errorMessage, formatDate, formatDateTime } from "../../../lib/format.ts";
import {
  cancelFinalInvoice,
  correctFinalInvoice,
  getInvoiceDetail,
} from "../../../server/functions/invoices.ts";

export const Route = createFileRoute("/_app/rechnungen/$id")({
  loader: ({ params }) => getInvoiceDetail({ data: params.id }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.invoice.number ? `Rechnung ${loaderData.invoice.number}` : "Rechnungsentwurf"} · Haben` }],
  }),
  component: InvoicePage,
});

type Detail = Awaited<ReturnType<typeof getInvoiceDetail>>;

const KIND_TITLE = { rechnung: "Rechnung", storno: "Stornorechnung", korrektur: "Rechnungskorrektur" } as const;
const FORMAT_LABEL = {
  zugferd: "ZUGFeRD · EN 16931",
  "xrechnung-cii": "XRechnung 3.0 (CII)",
  "xrechnung-ubl": "XRechnung 3.0 (UBL)",
} as const;

function InvoicePage() {
  const data = Route.useLoaderData();
  const { invoice } = data;
  if (invoice.status === "draft") {
    return (
      <InvoiceEditor
        // nach dem Speichern mit den gespeicherten Werten neu aufsetzen
        key={`${invoice.id}-${String(invoice.updatedAt)}`}
        id={invoice.id}
        kind={invoice.kind}
        initial={{
          contactId: invoice.contactId,
          issueDate: invoice.issueDate,
          serviceFrom: invoice.serviceFrom,
          serviceTo: invoice.serviceTo,
          paymentTermDays: invoice.paymentTermDays,
          format: invoice.format,
          note: invoice.note,
          taxTreatment: invoice.taxTreatment,
          exemptionReason: invoice.exemptionReason,
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
        corrects={data.corrects}
        bundesland={data.bundesland}
        kleinunternehmer={data.kleinunternehmer}
      />
    );
  }
  return <FinalInvoice data={data} />;
}

function FinalInvoice({ data }: { data: Detail }) {
  const { invoice, corrects, correctedBy } = data;
  const router = useRouter();
  const navigate = useNavigate();
  const cancel = useServerFn(cancelFinalInvoice);
  const correct = useServerFn(correctFinalInvoice);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buyer = invoice.buyer as { name: string } | null;
  const cancelled = correctedBy.find((c) => c.kind === "storno" && c.status === "final");
  const canAmend = invoice.kind === "rechnung" && !cancelled;

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const onCancel = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    void run(async () => {
      const storno = await cancel({ data: invoice.id });
      setConfirming(false);
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
            <Link to="/rechnungen">Rechnungen</Link> › {KIND_TITLE[invoice.kind]}
          </div>
          <h1>
            {KIND_TITLE[invoice.kind]} {invoice.number}
          </h1>
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
        </div>
      </div>

      {cancelled && (
        <div className="banner banner-danger" role="status">
          <Icon name="alert" />
          <span>
            Storniert durch <Link to="/rechnungen/$id" params={{ id: cancelled.id }}>Stornorechnung {cancelled.number}</Link>.
          </span>
        </div>
      )}
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}

      <div className="grid-main">
        <section aria-label="PDF">
          <iframe className="pdf-frame" src={`/api/rechnung/${invoice.id}/pdf`} title={`PDF der Rechnung ${invoice.number}`} />
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
                  <dt>Fällig</dt>
                  <dd>{formatDate(invoice.dueDate)}</dd>
                </>
              )}
              <dt>Netto</dt>
              <dd className="mono">{formatEuro(invoice.net)}</dd>
              <dt>Umsatzsteuer</dt>
              <dd className="mono">{formatEuro(invoice.tax)}</dd>
              <dt>Brutto</dt>
              <dd className="mono" style={{ fontWeight: 600 }}>
                {formatEuro(invoice.gross)}
              </dd>
              <dt>Format</dt>
              <dd>{invoice.lexofficeVoucherId ? "Original aus Lexoffice" : FORMAT_LABEL[invoice.format]}</dd>
              {invoice.taxTreatment !== "regulaer" && (
                <>
                  <dt>Umsatzsteuer</dt>
                  <dd>{TAX_TREATMENTS[invoice.taxTreatment].label}</dd>
                </>
              )}
              <dt>Festgeschrieben</dt>
              <dd>{invoice.lockedAt ? formatDateTime(invoice.lockedAt) : "–"}</dd>
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

          {(data.dunnings.length > 0 || data.overdue) && (
            <section className="card" aria-labelledby="dunning-heading">
              <h2 id="dunning-heading">Mahnungen</h2>
              {data.dunnings.map((d) => (
                <div key={d.id} className="history-row">
                  <a href={`/api/mahnung/${d.id}`} target="_blank" rel="noreferrer">
                    {DUNNING_LEVELS[d.level as DunningLevel].label} vom {formatDate(d.date)}
                  </a>
                  <span className="small muted">
                    {formatEuro(d.total)} bis {formatDate(d.dueDate)}
                  </span>
                </div>
              ))}
              {data.overdue && (
                <div className="actions">
                  <Link to="/rechnungen/mahnwesen/$id" params={{ id: invoice.id }} className="btn">
                    {data.dunnings.length === 0 ? "Zahlungserinnerung erstellen" : "Nächste Mahnstufe"}
                  </Link>
                </div>
              )}
            </section>
          )}

          {correctedBy.length > 0 && (
            <section className="card" aria-labelledby="related-heading">
              <h2 id="related-heading">Korrekturen</h2>
              {correctedBy.map((c) => (
                <div key={c.id} className="history-row">
                  <Link to="/rechnungen/$id" params={{ id: c.id }}>
                    {KIND_TITLE[c.kind]} {c.number ?? "(Entwurf)"}
                  </Link>
                  <span className={`pill ${c.status === "draft" ? "pill-info" : ""}`}>{c.status === "draft" ? "Entwurf" : "festgeschrieben"}</span>
                </div>
              ))}
            </section>
          )}

          {canAmend && (
            <section className="card" aria-labelledby="amend-heading">
              <h2 id="amend-heading">Korrigieren</h2>
              <p className="small muted" style={{ margin: 0 }}>
                Festgeschriebene Rechnungen bleiben unverändert. Eine Stornorechnung hebt sie vollständig auf, eine
                Rechnungskorrektur mindert den Betrag teilweise.
              </p>
              {confirming && (
                <div className="banner" role="alert">
                  Es wird sofort eine Stornorechnung mit neuer Nummer erzeugt und gebucht. Noch einmal klicken zum Stornieren.
                </div>
              )}
              <div className="actions">
                <button type="button" className="btn" onClick={onCancel} disabled={busy}>
                  {confirming ? "Jetzt stornieren" : "Stornieren"}
                </button>
                <button type="button" className="btn btn-dashed" onClick={onCorrect} disabled={busy}>
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
