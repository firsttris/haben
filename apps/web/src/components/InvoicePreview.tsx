import {
  computeInvoiceTotals,
  formatDecimal,
  formatEuro,
  formatQuantity,
  formatRate,
  lineNet,
  type InvoiceLineInput,
} from "@haben/core";
import { formatDate } from "../lib/format.ts";

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
}

export interface PreviewBuyer {
  name: string;
  strasse: string;
  plz: string;
  ort: string;
  kundennummer?: string | null;
}

const TITLE = { rechnung: "Rechnung", storno: "Stornorechnung", korrektur: "Rechnungskorrektur" } as const;

/** HTML-Abbild des PDFs für den Editor; das verbindliche Dokument rendert Typst. */
export function InvoicePreview({
  kind,
  number,
  issueDate,
  dueDate,
  serviceFrom,
  serviceTo,
  seller,
  buyer,
  lines,
  note,
  taxNote,
  corrects,
}: {
  kind: keyof typeof TITLE;
  number: string;
  issueDate: string;
  dueDate: string;
  serviceFrom: string | null;
  serviceTo: string | null;
  seller: PreviewSeller;
  buyer: PreviewBuyer | null;
  lines: (InvoiceLineInput & { valid: boolean })[];
  note: string;
  /** Pflichthinweis bei Rechnungen ohne Steuerausweis; dann keine Steuerspalte */
  taxNote?: string | null;
  corrects?: { number: string | null; issueDate: string } | null;
}) {
  const valid = lines.filter((l) => l.valid);
  const totals = computeInvoiceTotals(valid);
  const sender = [seller.name, seller.strasse, `${seller.plz} ${seller.ort}`.trim()].filter(Boolean).join(" · ");
  const service =
    serviceFrom && serviceTo && serviceFrom !== serviceTo
      ? `${formatDate(serviceFrom)} – ${formatDate(serviceTo)}`
      : serviceFrom || serviceTo
        ? formatDate((serviceFrom ?? serviceTo)!)
        : formatDate(issueDate);

  return (
    <div className="paper" aria-label="Vorschau der Rechnung">
      <div className="paper-head">
        <div className="paper-company">{seller.name || "[Firmenname]"}</div>
        <div className="paper-contact">
          {seller.strasse || "[Anschrift]"}
          <br />
          {seller.plz} {seller.ort}
          <br />
          {seller.email}
        </div>
      </div>
      <div className="paper-window">
        <div className="paper-sender">{sender || "[Absender]"}</div>
        {buyer ? (
          <>
            <div>{buyer.name}</div>
            <div>{buyer.strasse}</div>
            <div>
              {buyer.plz} {buyer.ort}
            </div>
          </>
        ) : (
          <div className="muted">[Kunde wählen]</div>
        )}
      </div>
      <div className="paper-title-row">
        <div className="paper-title">{TITLE[kind]}</div>
        <dl className="paper-meta">
          <dt>Nummer</dt>
          <dd>{number}</dd>
          <dt>Datum</dt>
          <dd>{formatDate(issueDate)}</dd>
          <dt>Leistung</dt>
          <dd>{service}</dd>
          {buyer?.kundennummer && (
            <>
              <dt>Kunde</dt>
              <dd>{buyer.kundennummer}</dd>
            </>
          )}
        </dl>
      </div>
      {corrects && (
        <p className="paper-small">
          zur Rechnung {corrects.number} vom {formatDate(corrects.issueDate)}
        </p>
      )}
      <table className="paper-table">
        <thead>
          <tr>
            <th>Beschreibung</th>
            <th className="num">Menge</th>
            <th className="num">Preis</th>
            <th className="num">USt</th>
            <th className="num">Netto</th>
          </tr>
        </thead>
        <tbody>
          {valid.map((line, index) => (
            <tr key={index}>
              <td>{line.description}</td>
              <td className="num">
                {formatQuantity(line.quantity)} {line.unit}
              </td>
              <td className="num">{formatDecimal(line.unitPrice)}</td>
              <td className="num">{taxNote ? "–" : formatRate(line.taxRate)}</td>
              <td className="num">{formatDecimal(lineNet(line.quantity, line.unitPrice))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="paper-totals">
        <dt>Summe netto</dt>
        <dd>{formatEuro(totals.net)}</dd>
        {totals.taxes
          .filter((t) => t.rate > 0)
          .map((t) => (
            <div key={t.rate} style={{ display: "contents" }}>
              <dt>Umsatzsteuer {formatRate(t.rate)}</dt>
              <dd>{formatEuro(t.tax)}</dd>
            </div>
          ))}
        <dt className="strong">Gesamtbetrag</dt>
        <dd className="strong">{formatEuro(totals.gross)}</dd>
      </dl>
      {taxNote && <p className="paper-small strong">{taxNote}</p>}
      {note && <p className="paper-small" style={{ whiteSpace: "pre-wrap" }}>{note}</p>}
      <p className="paper-small">
        {totals.gross >= 0
          ? `Bitte überweisen Sie den Betrag bis zum ${formatDate(dueDate)} unter Angabe der Rechnungsnummer.`
          : "Der Betrag wird Ihnen erstattet."}
      </p>
      <div className="paper-foot">
        <span>
          {seller.name}
          <br />
          {seller.strasse}, {seller.plz} {seller.ort}
        </span>
        <span>
          {seller.bank || "Bank"}
          <br />
          IBAN {seller.iban || "[IBAN]"}
        </span>
        <span>
          {seller.steuernummer && <>Steuernummer {seller.steuernummer}<br /></>}
          {seller.ustId && <>USt-IdNr. {seller.ustId}</>}
        </span>
      </div>
    </div>
  );
}
