import { formatEuro } from "@haben/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { LEGACY_TYPES } from "../../../components/archiv/LegacyVouchers.tsx";
import { formatDate, formatDateTime } from "../../../lib/format.ts";
import { getLegacyVoucher } from "../../../server/functions/archive.ts";

export const Route = createFileRoute("/_app/archiv/beleg/$id")({
  loader: ({ params }) => getLegacyVoucher({ data: { id: params.id } }),
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.voucher.number || "Beleg"} · Archiv · Haben` }] }),
  component: LegacyVoucherPage,
});

const PAYMENT_STATUS: Record<string, string> = {
  balanced: "ausgeglichen",
  openRevenue: "offene Forderung",
  openExpense: "offene Verbindlichkeit",
};

function LegacyVoucherPage() {
  const { voucher, files } = Route.useLoaderData();
  const [selected, setSelected] = useState(files.find((f) => f.role === "pdf")?.id ?? files[0]?.id ?? null);
  const file = files.find((f) => f.id === selected) ?? null;
  const src = file ? `/api/altbeleg/${file.id}` : null;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/archiv" search={{ ansicht: "belege", jahr: Number(voucher.date.slice(0, 4)) }}>
              Archiv
            </Link>{" "}
            › {LEGACY_TYPES[voucher.type] ?? voucher.type} aus Lexoffice
          </div>
          <h1>{voucher.number || voucher.contactName || "Beleg"}</h1>
        </div>
      </div>
      <div className="grid-main">
        <section className="card stack" aria-label="Datei">
          {files.length > 1 && (
            <div className="filter-row" role="group" aria-label="Datei wählen">
              {files.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={f.id === selected ? "chip active" : "chip"}
                  aria-pressed={f.id === selected}
                  onClick={() => setSelected(f.id)}
                >
                  {f.role === "xml" ? "E-Rechnung (XML)" : f.filename}
                </button>
              ))}
            </div>
          )}
          {!file || !src ? (
            <div className="banner banner-info">Zu diesem Beleg hat Lexware Office keine Datei geliefert.</div>
          ) : file.mimeType === "application/pdf" ? (
            <iframe className="doc-preview" src={src} title={`Datei ${file.filename}`} />
          ) : file.mimeType.startsWith("image/") ? (
            <img className="doc-image" src={src} alt={`Beleg ${file.filename}`} />
          ) : (
            <iframe className="doc-preview" src={src} title={`Datei ${file.filename}`} sandbox="" />
          )}
          {file && src && (
            <a className="btn" href={`${src}?download`} download>
              {file.filename} herunterladen
            </a>
          )}
        </section>
        <div className="stack">
          <section className="card stack" aria-labelledby="facts-heading">
            <h2 id="facts-heading" style={{ margin: 0 }}>Angaben</h2>
            <dl className="facts">
              <dt>Kontakt</dt>
              <dd>
                {voucher.contactId ? (
                  <Link to="/kontakte/$id" params={{ id: voucher.contactId }}>
                    {voucher.contactName}
                  </Link>
                ) : (
                  voucher.contactName || "–"
                )}
              </dd>
              <dt>Datum</dt>
              <dd>{formatDate(voucher.date)}</dd>
              {voucher.serviceFrom && (
                <>
                  <dt>Leistung</dt>
                  <dd>
                    {formatDate(voucher.serviceFrom)}
                    {voucher.serviceTo && voucher.serviceTo !== voucher.serviceFrom ? ` bis ${formatDate(voucher.serviceTo)}` : ""}
                  </dd>
                </>
              )}
              {voucher.dueDate && (
                <>
                  <dt>Fällig</dt>
                  <dd>{formatDate(voucher.dueDate)}</dd>
                </>
              )}
              <dt>Status in Lexoffice</dt>
              <dd>{voucher.status}</dd>
              {voucher.taxes.map((t) => (
                <TaxRow key={t.rate} rate={t.rate} net={t.net} tax={t.tax} />
              ))}
              <dt>Brutto</dt>
              <dd className="mono" style={{ fontWeight: 600 }}>
                {formatEuro(voucher.gross)}
                {voucher.currency !== "EUR" ? ` (${voucher.currency})` : ""}
              </dd>
            </dl>
            {voucher.categories.length > 0 && (
              <div className="small muted">Kategorie: {voucher.categories.map((c) => c.name || c.categoryId).join(", ")}</div>
            )}
            {voucher.remark && <p className="small" style={{ margin: 0 }}>{voucher.remark}</p>}
          </section>
          {voucher.payment && (
            <section className="card stack" aria-labelledby="payment-heading">
              <h2 id="payment-heading" style={{ margin: 0 }}>Zahlungen</h2>
              <div className="small">
                {PAYMENT_STATUS[voucher.payment.status] ?? voucher.payment.status}
                {voucher.payment.openAmount ? `, offen ${formatEuro(voucher.payment.openAmount)}` : ""}
              </div>
              {voucher.payment.items.map((item, i) => (
                <div key={i} className="history-row small">
                  <span>{formatDate(item.date)}</span>
                  <span className="muted">{item.type}</span>
                  <span className="mono">{formatEuro(item.amount)}</span>
                </div>
              ))}
            </section>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            Übernommen am {formatDateTime(voucher.createdAt)} · Lexoffice-ID {voucher.lexofficeId}
          </p>
        </div>
      </div>
    </>
  );
}

function TaxRow({ rate, net, tax }: { rate: number; net: number; tax: number }) {
  const percent = `${(rate / 100).toLocaleString("de-DE")} %`;
  return (
    <>
      <dt>Netto {percent}</dt>
      <dd className="mono">{formatEuro(net)}</dd>
      <dt>USt {percent}</dt>
      <dd className="mono">{formatEuro(tax)}</dd>
    </>
  );
}
