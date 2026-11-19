import { describeExchangeRate, formatEuro, TAX_TREATMENTS } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { LockedAndArchived } from "../../../components/ArchiveStatus.tsx";
import { formatDate } from "../../../lib/format.ts";
import { FORMAT_LABEL } from "../../../lib/invoice.ts";
import { legacySource } from "../../../lib/altbestand.ts";
import type { Detail } from "./-rechnung-daten.ts";

/** Angaben einer festgeschriebenen Rechnung: Kunde, Daten, Beträge, Bezüge und Archiv */
export function RechnungAngaben({ data, cancelled }: { data: Detail; cancelled: Detail["correctedBy"][number] | undefined }) {
  const { invoice, corrects } = data;
  const buyer = invoice.buyer as { name: string } | null;
  return (
    <section className="card" aria-labelledby="facts-heading">
      <h2 id="facts-heading">Angaben</h2>
      <dl className="facts">
        <dt>Kunde</dt>
        <dd>{buyer?.name ?? "–"}</dd>
        <dt>Rechnungsdatum</dt>
        <dd>{formatDate(invoice.issueDate)}</dd>
        {invoice.kind === "rechnung" &&
          (invoice.paymentMethod === "bereits_bezahlt" && invoice.paidOn ? (
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
          ))}
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
              {invoice.exchangeRate ? describeExchangeRate(invoice.currency, invoice.exchangeRate, invoice.exchangeRateSource, invoice.exchangeRateDate) : "–"}
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
  );
}
