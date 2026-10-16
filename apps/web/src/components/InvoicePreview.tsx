import {
  computeInvoiceTotals,
  formatEuro,
  formatQuantity,
  formatRate,
  lineAmount,
  type InvoiceLineInput,
  type PriceMode,
} from "@haben/core";
import { formatDate } from "../lib/format.ts";
import { KIND_TITLE } from "../lib/invoice.ts";

export interface PreviewSeller {
  name: string;
  strasse: string;
  plz: string;
  ort: string;
  email: string;
  steuernummer: string;
  ustId: string;
  iban: string;
  bic: string;
  bank: string;
  /** SHA-256 des Logos, wenn eines hinterlegt ist */
  logo?: string | null;
}

export interface PreviewBuyer {
  name: string;
  strasse: string;
  plz: string;
  ort: string;
  kundennummer?: string | null;
}


/** HTML-Abbild des PDFs für den Editor; das verbindliche Dokument rendert Typst. */
export function InvoicePreview({
  kind,
  number,
  issueDate,
  dueDate,
  validUntil = null,
  serviceFrom,
  serviceTo,
  seller,
  buyer,
  lines,
  note,
  priceMode = "netto",
  taxNote,
  corrects,
  title,
}: {
  kind: keyof typeof KIND_TITLE;
  number: string;
  issueDate: string;
  dueDate: string;
  /** Nur beim Angebot */
  validUntil?: string | null;
  serviceFrom: string | null;
  serviceTo: string | null;
  seller: PreviewSeller;
  buyer: PreviewBuyer | null;
  lines: (InvoiceLineInput & { valid: boolean })[];
  note: string;
  /** Bruttopreise: letzte Spalte brutto, unter dem Gesamtbetrag „darin enthalten“ */
  priceMode?: PriceMode;
  /** Pflichthinweis bei Rechnungen ohne Steuerausweis; dann keine Steuerspalte */
  taxNote?: string | null;
  corrects?: { number: string | null; issueDate: string } | null;
  /** Abweichender Titel, z. B. Abschlagsrechnung */
  title?: string;
}) {
  const valid = lines.filter((l) => l.valid);
  const gross = priceMode === "brutto";
  const totals = computeInvoiceTotals(valid, priceMode);
  const quote = kind === "angebot";
  const sender = [seller.name, seller.strasse, `${seller.plz} ${seller.ort}`.trim()].filter(Boolean).join(" · ");
  const meta: [string, string][] = [
    [quote ? "Angebotsnummer" : "Rechnungsnummer", number],
    [quote ? "Angebotsdatum" : "Rechnungsdatum", formatDate(issueDate)],
  ];
  if (quote) meta.push(["Gültig bis", validUntil ? formatDate(validUntil) : "–"]);
  if (serviceFrom && serviceTo && serviceFrom !== serviceTo) {
    meta.push(["Leistungszeitraum", `${formatDate(serviceFrom)} – ${formatDate(serviceTo)}`]);
  } else if (serviceFrom || serviceTo) {
    meta.push(["Leistungsdatum", formatDate((serviceFrom ?? serviceTo)!)]);
  } else if (!quote) {
    meta.push(["Leistungsdatum", "entspricht Rechnungsdatum"]);
  }
  if (buyer?.kundennummer) meta.push(["Kundennummer", buyer.kundennummer]);
  // Wie im PDF: bei mehreren Steuersätzen steht die Bemessungsgrundlage dabei
  const taxes = taxNote ? [] : totals.taxes;
  const payment = quote
    ? `Dieses Angebot gilt bis zum ${validUntil ? formatDate(validUntil) : "…"}. Wir freuen uns auf Ihren Auftrag.`
    : totals.gross < 0
      ? "Der Betrag wird Ihnen erstattet."
      : totals.gross === 0
        ? "Es ist keine Zahlung erforderlich."
        : `Bitte überweisen Sie den Betrag bis zum ${formatDate(dueDate)} unter Angabe der Rechnungsnummer.`;
  const footer = [
    [seller.name || "[Firmenname]", seller.strasse, `${seller.plz} ${seller.ort}`.trim(), seller.email],
    [seller.bank, `IBAN ${seller.iban || "[IBAN]"}`, seller.bic && `BIC ${seller.bic}`],
    [seller.steuernummer && `Steuernummer ${seller.steuernummer}`, seller.ustId && `USt-IdNr. ${seller.ustId}`],
  ].map((column) => column.filter(Boolean));

  // Maße in mm wie in templates/rechnung.typ (DIN 5008 Form B), über --mm auf die Breite skaliert
  return (
    <div className="sheet-frame">
      <div className="sheet" aria-label={quote ? "Vorschau des Angebots" : "Vorschau der Rechnung"}>
        <span className="sheet-fold" style={{ top: "calc(105 * var(--mm))" }} />
        <span className="sheet-fold long" style={{ top: "calc(148.5 * var(--mm))" }} />
        <span className="sheet-fold" style={{ top: "calc(210 * var(--mm))" }} />
        {seller.logo && <img className="sheet-logo" src={`/api/logo?v=${seller.logo.slice(0, 12)}`} alt="Logo" />}
        <div className="sheet-address">
          <div className="sheet-sender">{sender || "[Absender]"}</div>
          {buyer ? (
            <div>
              {buyer.name}
              <br />
              {buyer.strasse}
              <br />
              {buyer.plz} {buyer.ort}
            </div>
          ) : (
            <div className="sheet-muted">[Kunde wählen]</div>
          )}
        </div>
        <dl className="sheet-meta">
          {meta.map(([label, value]) => (
            <div key={label} style={{ display: "contents" }}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="sheet-body">
          <div className="sheet-title">{title ?? KIND_TITLE[kind]}</div>
          {corrects && (
            <div className="sheet-muted">
              zur Rechnung {corrects.number} vom {formatDate(corrects.issueDate)}
            </div>
          )}
          <table className="sheet-table">
            <thead>
              <tr>
                <th>Pos.</th>
                <th>Beschreibung</th>
                <th className="num">Menge</th>
                <th className="num">Einzelpreis</th>
                <th className="num">USt</th>
                <th className="num">{gross ? "Brutto" : "Netto"}</th>
              </tr>
            </thead>
            <tbody>
              {valid.map((line, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td className="desc">{line.description}</td>
                  <td className="num">
                    {formatQuantity(line.quantity)} {line.unit}
                  </td>
                  <td className="num">{formatEuro(line.unitPrice)}</td>
                  <td className="num">{taxNote ? "–" : formatRate(line.taxRate)}</td>
                  <td className="num">{formatEuro(lineAmount(line.quantity, line.unitPrice))}</td>
                </tr>
              ))}
              {valid.length === 0 && (
                <tr>
                  <td />
                  <td className="sheet-muted" colSpan={5}>
                    [Positionen]
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <dl className="sheet-totals">
            {!gross && (
              <>
                <dt>Summe netto</dt>
                <dd>{formatEuro(totals.net)}</dd>
                {taxes.map((t) => (
                  <div key={t.rate} style={{ display: "contents" }}>
                    <dt>
                      Umsatzsteuer {formatRate(t.rate)}
                      {taxes.length > 1 && ` auf ${formatEuro(t.base)}`}
                    </dt>
                    <dd>{formatEuro(t.tax)}</dd>
                  </div>
                ))}
              </>
            )}
            <dt className="gross">
              {quote ? "Angebotssumme" : "Gesamtbetrag"}
              {gross && " (inkl. USt)"}
            </dt>
            <dd className="gross">{formatEuro(totals.gross)}</dd>
            {gross && taxes.length > 0 && (
              <>
                <dt className="sheet-included">darin enthalten:</dt>
                <dd className="sheet-included" />
                {taxes.map((t) => (
                  <div key={t.rate} style={{ display: "contents" }}>
                    <dt className="sheet-included">Netto{taxes.length > 1 && ` ${formatRate(t.rate)}`}</dt>
                    <dd className="sheet-included">{formatEuro(t.base)}</dd>
                    <dt className="sheet-included">Umsatzsteuer {formatRate(t.rate)}</dt>
                    <dd className="sheet-included">{formatEuro(t.tax)}</dd>
                  </div>
                ))}
              </>
            )}
          </dl>
          {taxNote && <p className="sheet-strong">{taxNote}</p>}
          <p>{payment}</p>
          {note && <p style={{ whiteSpace: "pre-wrap" }}>{note}</p>}
        </div>
        <div className="sheet-foot">
          {footer.map((column, index) => (
            <div key={index}>
              {column.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
